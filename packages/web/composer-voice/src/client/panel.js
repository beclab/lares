import React from "react";
import { createVoicePanel } from "@olares/lares-core/voice/panel";
import { createVoiceConversation } from "@olares/lares-core/voice/conversation";
import { createRealtimeConversation } from "@olares/lares-core/voice/realtime-conversation";
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
    complete: async ({ sessionId, text }) => {
      const target = panel.target;
      if (target?.sessionId !== sessionId) throw new Error("voice_draft_changed");
      const span = target.inputActions?.captureInsertion(); const value = target.draft;
      if (!span || !target.inputActions.insertText(`${value && !/\s$/.test(value) ? " " : ""}${text}`, { ...span, start: value.length, end: value.length })) throw new Error("voice_draft_changed");
    },
    create: async ({ mode, onTranscript, onDevice }) => {
      const settings = await loadVoiceSettings({ force: true }); const config = settings.config;
      const continuous = mode === "continuous"; const device = captureSource("pc", config.device); onDevice(device);
      if (config.backend === "realtime" && continuous) return createRealtimeConversation({ request, presentationSession: true, readAloud: config.speak,
        idleTimeoutMs: config.idleTimeoutMs, recoveryTimeoutMs: config.recoveryTimeoutMs, device,
        socket: (ticket) => { const url = new URL("/api/lares/voice/realtime", location.href); url.protocol = location.protocol === "https:" ? "wss:" : "ws:"; return new WebSocket(url, ["lares-voice", `lares-ticket.${ticket}`]); },
      });
      const browser = createBrowserPlayer(); let conversation;
      const reader = createSentencePlayer({ send: (value) => conversation.speak(value).then((result) => ({ ...result, blob: result.audio ? wavBlob(result.audio) : null })),
        play: (sentence) => sentence.bluetooth === "played" ? Promise.resolve() : browser.play(sentence.blob), halt: browser.stop, silence: () => {},
        fail: (error) => { void conversation.controller.disconnect(error.code || "voice_playback_failed"); }, onState: (playing) => conversation?.playbackState(playing) });
      conversation = createVoiceConversation({ request, mode: () => panel.target?.mode?.() || "queue", device, readAloud: continuous && config.speak, presentationSession: true,
        preset: continuous && config.preset === "dictation" ? "assistant" : config.preset,
        endpointSilenceMs: config.endpointSilenceMs, idleTimeoutMs: config.idleTimeoutMs, recoveryTimeoutMs: config.recoveryTimeoutMs,
        onTranscript: continuous ? null : onTranscript,
        transcribe: async (blob, signal) => { const response = await fetch("/api/lares/voice/transcribe", { method: "POST", body: blob, headers: { "content-type": blob.type }, signal }); const value = await response.json(); if (!response.ok) throw new Error(value.error?.code || "voice_failed"); return value.text; },
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
  const dialog = React.useRef(null); const focus = React.useRef(null); const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const element = dialog.current;
    if (view.visible && !element.open) { focus.current = document.activeElement; element.showModal(); }
    else if (!view.visible && element.open) { element.close(); focus.current?.focus?.(); }
  }, [view.visible]);
  React.useEffect(() => { if (!view.visible) return; const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, [view.visible]);
  React.useEffect(() => { const pause = () => { if (document.hidden) void panel.pause().catch(() => {}); }; document.addEventListener("visibilitychange", pause); return () => document.removeEventListener("visibilitychange", pause); }, [panel]);
  const act = (operation) => { void operation().catch(() => {}); };
  const button = (label, operation, disabled = view.busy) => h("button", { type: "button", disabled, onClick: () => act(operation) }, t(label));
  const state = view.snapshot; const active = state?.connection === "open";
  return h("dialog", { ref: dialog, className: "lares-voice-panel", "aria-labelledby": "lares-voice-panel-title",
    onCancel: (event) => { event.preventDefault(); act(() => panel.close()); }, onClick: (event) => { if (event.target === dialog.current) act(() => panel.close()); } },
    h("div", { className: "lares-voice-panel-body" },
      h("header", null, h("h2", { id: "lares-voice-panel-title" }, t("panel.title")), button("panel.close", () => panel.close(), false)),
      h("div", { role: "tablist", "aria-label": t("settings.mode") }, ...["single", "continuous"].map((mode) => h("button", { type: "button", role: "tab", key: mode,
        "aria-selected": mode === view.mode, tabIndex: mode === view.mode ? 0 : -1, "aria-controls": "lares-voice-panel-content", id: `lares-voice-tab-${mode}`, disabled: view.busy,
        onKeyDown: (event) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "single" : event.key === "End" ? "continuous" : view.mode === "single" ? "continuous" : "single"; act(() => panel.open({ mode: next })); dialog.current.querySelector(`#lares-voice-tab-${next}`)?.focus(); } },
        onClick: () => act(() => panel.open({ mode })) }, t(`settings.mode.${mode}`)))),
      h("section", { role: "tabpanel", id: "lares-voice-panel-content", "aria-labelledby": `lares-voice-tab-${view.mode}` },
        h("p", { className: "lares-voice-device" }, t(!view.device ? "settings.device.auto" : view.device === "headset" ? "settings.device.headset" : "settings.device.device")),
        h("svg", { className: "lares-voice-wave", viewBox: "0 0 120 48", "aria-hidden": true }, ...(view.levels.length ? view.levels : Array(20).fill(0.003)).map((level, index) => h("line", { key: index, x1: index * 6 + 3, x2: index * 6 + 3, y1: 24 - Math.max(2, Math.min(22, level * 800)), y2: 24 + Math.max(2, Math.min(22, level * 800)) }))),
        h("p", { role: "timer", "aria-label": t("panel.elapsed") }, `${Math.max(0, Math.floor(((view.elapsedMs || 0) + (view.startedAt ? now - view.startedAt : 0)) / 1000))}s`),
        h("p", { role: "status", "aria-live": "polite" }, view.error || state?.error ? messageFor(t, view.error || state.error) : view.busy ? t("mic.preparing") : !active ? t("panel.paused") : t(state.capture === "transcribing" ? "mic.transcribing" : state.capture === "recording" ? "call.listening" : state.playback !== "idle" ? "call.halfDuplex" : "call.waiting")),
        view.mode === "single" ? h("div", { className: "lares-voice-draft", "aria-label": t("panel.draft"), "aria-live": "polite" }, view.draft || t("panel.draftHint")) : h("p", null, t("panel.messages")),
        h("div", { className: "lares-voice-panel-actions" },
          !active ? button(state?.connection === "paused" ? "panel.continue" : "panel.start", () => panel.start()) : button("panel.pause", () => panel.pause()),
          view.mode === "single" ? h(React.Fragment, null, button("panel.complete", () => panel.complete(), view.busy || (!view.draft && state?.capture !== "recording")), button("panel.discard", () => panel.discard())) : null,
          active && view.mode === "continuous" ? button(state.outputMuted ? "call.unmute" : "call.mute", () => panel.action("mute")) : null,
          active && view.mode === "continuous" ? button(state.inputPaused ? "call.resumeInput" : "call.pauseInput", () => panel.action("input")) : null,
          state?.playback !== "idle" && state ? button("call.stopPlayback", () => panel.action("playback")) : null,
          state ? button("call.end", () => panel.end()) : null)),
    ));
}
