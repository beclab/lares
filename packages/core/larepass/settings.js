import { createSnapshotStore } from "../tools/async.js";
import { callRpc } from "./chat.js";
import {
  CONVERSATION_SETTINGS_NAMESPACE,
  busyEnterBehavior,
  conversationSettings,
} from "./submission-settings.js";

const modelsStore = createSnapshotStore();
const voiceStore = createSnapshotStore();
const voiceListeners = new Set();
export function subscribeVoiceSettings(listener) { voiceListeners.add(listener); const current = voiceStore.peek(); if (current) listener(current); return () => voiceListeners.delete(listener); }
const searchStore = createSnapshotStore();
const conversationStore = createSnapshotStore();
const conversationListeners = new Set();

function publishConversation(value) {
  conversationStore.remember(value);
  for (const listener of conversationListeners) listener(value);
  return value;
}

export function subscribeConversationSettings(listener) {
  conversationListeners.add(listener);
  const current = conversationStore.peek();
  if (current) listener(current);
  return () => conversationListeners.delete(listener);
}

function fail(res, path) {
  const err = res?.body?.error;
  const code = typeof err?.code === "string" ? err.code : "";
  const message = err?.message || code || `${path} ${res?.status ?? ""}`.trim();
  throw Object.assign(new Error(message), code ? { code } : {});
}

function payload(res, path) {
  if (!res?.ok) fail(res, path);
  return res.body;
}

function rpcValue(result, method) {
  if (result?.ok) return result.value;
  throw new Error(result?.error?.message || result?.error?.code || method);
}

function modelIds(body, key) {
  const list = Array.isArray(body?.[key]) ? body[key] : [];
  return list.map((item) => (typeof item === "string" ? item : item?.id)).filter(Boolean);
}

export function rememberedSettings() {
  return {
    models: modelsStore.peek(),
    voice: voiceStore.peek(),
    search: searchStore.peek(),
    conversation: conversationStore.peek(),
  };
}

export function resetHostSettingsCache() {
  modelsStore.remember(null);
  voiceStore.remember(null);
  searchStore.remember(null);
  conversationStore.remember(null);
}

export function createHostSettings(request) {
  return {
    async models(options = {}) {
      return modelsStore.load(
        async () => payload(await request("/api/lares/models"), "/api/lares/models"),
        options,
      );
    },
    async refreshModels() {
      return modelsStore.remember(
        payload(
          await request("/api/lares/models/refresh", { method: "POST" }),
          "/api/lares/models/refresh",
        ),
      );
    },
    async setDefaultModel(selection) {
      return modelsStore.remember(
        payload(
          await request("/api/lares/models/default", { method: "POST", body: selection }),
          "/api/lares/models/default",
        ),
      );
    },
    async voice(force = false, { diagnostics = true } = {}) {
      return voiceStore.load(async () => {
        const query = force ? "?refresh=1" : "";
        const [config, status, models] = await Promise.all([
          request("/api/lares/voice/config"),
          diagnostics ? request(`/api/lares/voice/status${query}`) : Promise.resolve(null),
          request(`/api/lares/voice/${diagnostics ? "models" : "capabilities"}${query}`),
        ]);
        const listed = payload(models, "/api/lares/voice/capabilities");
        return {
          config: payload(config, "/api/lares/voice/config"),
          status: status ? payload(status, "/api/lares/voice/status") : { modelAvailable: Boolean(listed.selected), model: listed.selected || "" },
          sttModels: modelIds(listed, "stt"),
          ttsModels: modelIds(listed, "tts"),
          ttsSelected: listed.ttsSelected || "",
          ttsDefault: listed.ttsDefault || "",
          chatModels: modelIds(listed, "chat"),
          realtimeModels: modelIds(listed, "realtime"),
          realtimeReady: modelIds(listed, "realtimeReady"),
        };
      }, { force: Boolean(force) });
    },
    async saveVoice(patch, { diagnostics = true } = {}) {
      const config = payload(
        await request("/api/lares/voice/config", { method: "POST", body: patch }),
        "/api/lares/voice/config",
      );
      const previous = voiceStore.peek();
      const value = !diagnostics && previous ? voiceStore.remember({ ...previous, config }) : await this.voice(true, { diagnostics });
      for (const listener of voiceListeners) listener(value);
      return value;
    },
    async search(options = {}) {
      const query = options.force ? "?refresh=1" : "";
      return searchStore.load(
        async () => payload(
          await request(`/api/lares/web-search/config${query}`),
          "/api/lares/web-search/config",
        ),
        options,
      );
    },
    async setSearchDefault(selection) {
      return searchStore.remember(
        payload(
          await request("/api/lares/web-search/config/default", {
            method: "POST",
            body: selection,
          }),
          "/api/lares/web-search/config/default",
        ),
      );
    },
    async conversation(options = {}) {
      const value = await conversationStore.load(async () => {
        const described = rpcValue(await callRpc(request, "settings.describe"), "settings.describe");
        return conversationSettings(described);
      }, options);
      return publishConversation(value);
    },
    async setBusyEnter(value) {
      const current = await this.conversation();
      if (!current.writable) throw new Error("settings are read-only");
      const next = rpcValue(await callRpc(request, "settings.update", {
        ns: CONVERSATION_SETTINGS_NAMESPACE,
        patch: { busyEnter: busyEnterBehavior(value) },
        ...(current.revision === undefined ? {} : { expectedRevision: current.revision }),
      }), "settings.update");
      return publishConversation({
        busyEnter: busyEnterBehavior(next.value?.busyEnter),
        revision: Number.isInteger(next.revision) ? next.revision : undefined,
        writable: true,
      });
    },
  };
}
