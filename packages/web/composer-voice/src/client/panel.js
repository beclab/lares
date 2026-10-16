import React from "react";
import { DICTATION_PRESETS } from "@olares/lares-core/voice/dictation";
import { createHoldGesture } from "@olares/lares-core/voice/hold";
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
  const dialog = React.useRef(null), focus = React.useRef(null); const [now, setNow] = React.useState(Date.now());
  const act = (operation) => { void operation().catch(() => {}); };
  const gesture = React.useMemo(() => createHoldGesture({ start: () => act(() => panel.holdStart()), end: (cancel) => act(() => panel.holdEnd(cancel)) }), [panel]);
  React.useEffect(() => {
    const element = dialog.current;
    if (view.visible && !element.open) { focus.current = document.activeElement; element.showModal(); }
    else if (!view.visible && element.open) { gesture.cancel(); element.close(); focus.current?.focus?.(); }
  }, [view.visible]);
  React.useEffect(() => { if (!view.visible) return; const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, [view.visible]);
  React.useEffect(() => { const pause = () => { if (document.hidden) { gesture.cancel(); act(() => panel.pause()); } }; document.addEventListener("visibilitychange", pause); return () => document.removeEventListener("visibilitychange", pause); }, [panel]);
  const button = (label, operation, disabled = view.busy) => h("button", { type: "button", disabled, onClick: () => act(operation) }, t(label));
  const recording = view.snapshot?.capture === "recording";
  const preview = view.stage === "preview" || view.stage === "processing";
  return h("dialog", { ref: dialog, className: "lares-voice-panel", "aria-labelledby": "lares-voice-panel-title",
    onCancel: (event) => { event.preventDefault(); act(() => panel.close()); }, onClick: (event) => { if (event.target === dialog.current) act(() => panel.close()); } },
    h("div", { className: "lares-voice-panel-body" },
      h("header", null, h("h2", { id: "lares-voice-panel-title" }, t(`settings.mode.${view.mode}`)), button("panel.close", () => panel.close(), false)),
      h("section", null,
        !preview ? h(React.Fragment, null,
          h("svg", { className: "lares-voice-wave", viewBox: "0 0 120 48", "aria-hidden": true }, ...(view.levels.length ? view.levels : Array(20).fill(0.003)).map((level, index) => h("line", { key: index, x1: index * 6 + 3, x2: index * 6 + 3, y1: 24 - Math.max(2, Math.min(22, level * 800)), y2: 24 + Math.max(2, Math.min(22, level * 800)) }))),
          h("p", { role: "timer", "aria-label": t("panel.elapsed") }, `${Math.max(0, Math.floor(((view.elapsedMs || 0) + (view.startedAt ? now - view.startedAt : 0)) / 1000))}s`)) : null,
        h("p", { role: "status", "aria-live": "polite" }, view.error || view.snapshot?.error ? messageFor(t, view.error || view.snapshot.error) : t(view.stage === "processing" ? "dictation.processing" : view.snapshot?.capture === "transcribing" ? "mic.transcribing" : recording ? "call.listening" : view.busy ? "mic.preparing" : view.snapshot?.playback !== "idle" && view.snapshot ? "dictation.speaking" : view.mode === "continuous" ? "dictation.holdHint" : "dictation.preview")),
        view.mode === "single" && preview ? h(React.Fragment, null,
          h("select", { "aria-label": t("dictation.preset"), value: view.preset, disabled: view.busy, onChange: (event) => { const preset = event.target.value; if (!view.edited || confirm(t("dictation.replaceEdited"))) act(() => panel.selectPreset(preset, true)); } }, ...DICTATION_PRESETS.map((id) => h("option", { key: id, value: id }, t(`dictation.${id}`)))),
          h("textarea", { className: "lares-voice-draft", "aria-label": t("panel.draft"), value: view.draft, disabled: view.stage === "processing", onChange: (event) => panel.edit(event.target.value) }),
          h("details", null, h("summary", null, t("dictation.original")), h("p", { className: "lares-voice-original" }, view.raw)),
          view.error ? h("div", null, button("dictation.retry", () => panel.selectPreset(view.preset, true)), button("dictation.useOriginal", () => panel.selectPreset("raw", true))) : null) : null,
        h("div", { className: "lares-voice-panel-actions" }, view.mode === "single" ? preview ? h(React.Fragment, null,
          button("dictation.insert", () => panel.complete(), view.busy || !view.draft.trim()), button("dictation.discard", () => panel.discard())) : button(view.error || view.snapshot?.error ? "dictation.retry" : "dictation.finish", () => recording ? panel.finish() : panel.start(), view.busy || !recording && !view.error && !view.snapshot?.error) : h(React.Fragment, null,
          h("button", { type: "button", className: "lares-voice-hold", "aria-pressed": view.holding, disabled: view.busy && !view.holding || view.snapshot?.capture === "transcribing",
            onPointerDown: gesture.pointerDown, onPointerUp: gesture.pointerUp, onPointerCancel: gesture.cancel, onLostPointerCapture: gesture.cancel,
            onKeyDown: gesture.keyDown, onKeyUp: gesture.keyUp, onBlur: gesture.cancel,
            onClick: (event) => { if (event.detail === 0) act(() => view.holding ? panel.holdEnd() : panel.holdStart()); } }, t(view.holding ? "dictation.release" : "dictation.hold")),
          button("call.end", () => panel.end(), false))))));
}
