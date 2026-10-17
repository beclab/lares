import React from "react";
import { DICTATION_PRESETS } from "@olares/lares-core/voice/dictation";
import { voicePanelPresentation } from "@olares/lares-core/voice/presentation";
import { followVoiceAnchor } from "./floating.js";
import { createVoicePanel } from "@olares/lares-core/voice/panel";
import { createVoiceConversation } from "@olares/lares-core/voice/conversation";
import { createBrowserPlayer } from "@olares/lares-core/voice/browser-playback";
import { createSentencePlayer, speakable } from "@olares/lares-core/voice/speech";
import { captureSource } from "@olares/lares-core/voice/input";
import { loadVoiceSettings, wavBlob } from "@olares/lares-core/voice/client";
import { useT, messageFor } from "./locale.js";
export const request = async (url, options = {}) => {
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...options.headers }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  return { ok: response.ok, body: await response.json() };
};
export function createWebVoicePanel(onSession) {
  const panel = createVoicePanel({ onSession,
    loadConfig: async () => (await loadVoiceSettings({ force: true })).config,
    process: async ({ text, preset, config, signal }) => { const result = await request("/api/lares/voice/dictation/clean", { method: "POST", body: { text, preset, config: { dictationProfiles: config.dictationProfiles } }, signal }); if (!result.ok) throw new Error(result.body?.error?.code || "voice_cleanup_failed"); return result.body.text; },
    complete: async ({ sessionId, text }) => {
      const target = panel.target;
      if (target?.sessionId !== sessionId) throw new Error("voice_draft_changed");
      const span = target.inputActions?.captureInsertion(); const value = target.draft;
      if (!span || !target.inputActions.insertText(`${value && !/\s$/.test(value) ? " " : ""}${text}`, { ...span, start: value.length, end: value.length })) throw new Error("voice_draft_changed");
    },
    create: async ({ mode, onTranscript, onDevice, config }) => {
      const continuous = mode === "continuous"; const device = captureSource("pc", config.device); onDevice(device);
      if (config.backend === "realtime" && continuous) throw new Error("voice_manual_realtime_unavailable");
      const browser = createBrowserPlayer(); let conversation;
      const reader = createSentencePlayer({ send: (value) => conversation.speak(value).then((result) => ({ ...result, blob: result.audio ? wavBlob(result.audio) : null })),
        play: (sentence) => sentence.bluetooth === "played" ? Promise.resolve() : browser.play(sentence.blob), halt: browser.stop, silence: () => {},
        fail: (error) => { void conversation.controller.disconnect(error.code || "voice_playback_failed"); }, onState: (playing) => conversation?.playbackState(playing) });
      conversation = createVoiceConversation({ request, captureConfig: { model: config.model, language: config.language }, mode: () => panel.target?.mode?.() || "queue", device, readAloud: continuous && config.speak, presentationSession: true,
        preset: continuous && config.preset === "dictation" ? "assistant" : config.preset,
        endpointSilenceMs: config.endpointSilenceMs, idleTimeoutMs: config.idleTimeoutMs, recoveryTimeoutMs: config.recoveryTimeoutMs,
        onTranscript: continuous ? null : onTranscript,
        transcribe: async (blob, signal) => { const response = await fetch(`/api/lares/voice/transcribe?model=${encodeURIComponent(config.model || "")}&language=${encodeURIComponent(config.language || "")}`, { method: "POST", body: blob, headers: { "content-type": blob.type }, signal }); const value = await response.json(); if (!response.ok) throw new Error(value.error?.code || "voice_failed"); return value.text; },
        playback: { stop() { reader.stop(); browser.stop(); } }, onReply: (reply) => { const value = speakable(reply, config.streaming); if (value) reader.follow(value); },
      });
      return conversation;
    },
  });
  return panel;
}
const h = React.createElement;
export function VoicePanel({ panel }) {
  const t = useT(); const view = React.useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const dialog = React.useRef(null), focus = React.useRef(null), menu = React.useRef(null);
  const [showOriginal, setShowOriginal] = React.useState(false);
  const act = (operation) => { void operation().catch(() => {}); };
  React.useLayoutEffect(() => {
    const element = dialog.current;
    if (view.previewVisible && !element.open) { focus.current = panel.anchor || document.activeElement; element.showModal(); }
    else if (!view.previewVisible && element.open) { element.close(); focus.current?.focus?.(); }
    if (view.previewVisible) return followVoiceAnchor(element, () => panel.anchor || focus.current);
  }, [view.previewVisible, panel]);
  React.useEffect(() => { if (!view.previewVisible) setShowOriginal(false); }, [view.previewVisible]);
  const button = (label, operation, disabled = view.busy, className) => h("button", { type: "button", className, disabled, onClick: () => act(operation) }, t(label));
  const ui = voicePanelPresentation(view);
  const closeMenu = () => { if (menu.current) menu.current.open = false; };
  const choose = (preset) => {
    if (view.edited && !confirm(t("dictation.replaceEdited"))) return;
    closeMenu(); act(() => panel.selectPreset(preset, true));
  };
  return h("dialog", { ref: dialog, className: "lares-voice-panel", "data-mode": view.mode, "data-phase": ui.phase, "data-preview": ui.preview, "aria-labelledby": "lares-voice-panel-title",
    onCancel: (event) => { event.preventDefault(); act(() => panel.close()); }, onClick: (event) => { if (event.target === dialog.current) act(() => panel.close()); } },
    h("div", { className: "lares-voice-panel-body" },
      h("header", null, h("h2", { id: "lares-voice-panel-title" }, t(`settings.mode.${view.mode}`)), h("button", { type: "button", className: "lares-voice-close", "aria-label": t("panel.close"), onClick: () => act(() => panel.close()) }, "×")),
      h("section", { className: "lares-voice-content" },
        h("p", { className: "lares-voice-status", role: "status", "aria-live": "polite", "aria-atomic": true }, ui.error ? messageFor(t, ui.error) : t(ui.status)),
        ui.preview ? h(React.Fragment, null,
          h("details", { ref: menu, className: "lares-voice-menu" }, h("summary", { "aria-label": t("dictation.preset") }, t(`dictation.${view.preset}`), " ▾"),
            h("div", { className: "lares-voice-menu-body" }, h("select", { "aria-label": t("dictation.preset"), value: view.preset, disabled: view.busy, onChange: (event) => choose(event.target.value) }, ...DICTATION_PRESETS.map((id) => h("option", { key: id, value: id }, t(`dictation.${id}`)))),
              button("dictation.original", async () => { setShowOriginal((value) => !value); closeMenu(); }, false),
              ui.error ? h(React.Fragment, null, button("dictation.retry", async () => choose(view.preset)), button("dictation.useOriginal", async () => choose("raw"))) : null)),
          h("textarea", { className: "lares-voice-draft", "aria-label": t("panel.draft"), value: view.draft, disabled: ui.pending, onChange: (event) => panel.edit(event.target.value) }),
          showOriginal ? h("div", { className: "lares-voice-original", "aria-label": t("dictation.original") }, view.raw) : null) : null),
      h("footer", { className: "lares-voice-panel-actions" },
        button("dictation.insert", () => panel.complete(), view.busy || !view.draft.trim(), "lares-voice-primary"), button("dictation.discard", () => panel.discard()))));
}
