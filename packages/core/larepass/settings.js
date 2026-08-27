import { createSnapshotStore } from "../tools/async.js";

const modelsStore = createSnapshotStore();
const voiceStore = createSnapshotStore();
const searchStore = createSnapshotStore();

function fail(res, path) {
  const err = res?.body?.error;
  throw new Error(err?.message || err?.code || `${path} ${res?.status ?? ""}`.trim());
}

function payload(res, path) {
  if (!res?.ok) fail(res, path);
  return res.body;
}

function sttModels(body) {
  const list = Array.isArray(body?.stt) ? body.stt : [];
  return list.map((item) => (typeof item === "string" ? item : item?.id)).filter(Boolean);
}

export function rememberedSettings() {
  return {
    models: modelsStore.peek(),
    voice: voiceStore.peek(),
    search: searchStore.peek(),
  };
}

export function resetHostSettingsCache() {
  modelsStore.remember(null);
  voiceStore.remember(null);
  searchStore.remember(null);
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
    async voice(force = false) {
      return voiceStore.load(async () => {
        const query = force ? "?refresh=1" : "";
        const [config, status, models] = await Promise.all([
          request("/api/lares/voice/config"),
          request(`/api/lares/voice/status${query}`),
          request(`/api/lares/voice/models${query}`),
        ]);
        return {
          config: payload(config, "/api/lares/voice/config"),
          status: payload(status, "/api/lares/voice/status"),
          sttModels: sttModels(payload(models, "/api/lares/voice/models")),
        };
      }, { force: Boolean(force) });
    },
    async saveVoice(patch) {
      payload(
        await request("/api/lares/voice/config", { method: "POST", body: patch }),
        "/api/lares/voice/config",
      );
      return this.voice(true);
    },
    async search(options = {}) {
      return searchStore.load(
        async () => payload(await request("/api/lares/web-search/config"), "/api/lares/web-search/config"),
        options,
      );
    },
    async setSearchDefault(id) {
      return searchStore.remember(
        payload(
          await request("/api/lares/web-search/config/default", {
            method: "POST",
            body: { defaultSearchModel: id },
          }),
          "/api/lares/web-search/config/default",
        ),
      );
    },
  };
}
