import { captureSource } from "@olares/lares-core/voice/input";
import { createRealtimeConversation } from "@olares/lares-core/voice/realtime-conversation";
import React from "react";
import { createVoiceConversation } from "@olares/lares-core/voice/conversation";
import { createBrowserPlayer } from "@olares/lares-core/voice/browser-playback";
import { createSentencePlayer, speakable } from "@olares/lares-core/voice/speech";
import { loadVoiceSettings, wavBlob } from "@olares/lares-core/voice/client";
import { useT, messageFor } from "./locale.js";
import micCss from "./styles/mic.css";
export { micCss };
const h = React.createElement;
const { useEffect, useRef, useState } = React;
const request = async (url, options = {}) => {
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...options.headers }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  return { ok: response.ok, body: await response.json() };
};
export function MicButton({ sessionId, onActive = () => {}, mode = () => "queue", inputActions, useInput }) {
  const t = useT();
  const [defaultMode, setDefaultMode] = useState("single");
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [caption, setCaption] = useState("");
  const draft = useInput ? useInput((state) => state?.draft || "") : "";
  const draftRef = useRef(draft); draftRef.current = draft;
  const [records, setRecords] = useState(null);
  const [levels, setLevels] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const [opening, setOpening] = useState(false);
  const call = useRef(null);
  const cleanup = useRef(() => {});
  useEffect(() => {
    const abort = new AbortController();
    void request("/api/lares/voice/config", { signal: abort.signal }).then((result) => { if (!abort.signal.aborted && result.ok) setDefaultMode(result.body.mode); }).catch(() => {});
    return () => abort.abort();
  }, [sessionId]);
  const current = useRef(sessionId);
  current.current = sessionId;
  useEffect(() => () => { cleanup.current(); void call.current?.stop().catch(() => {}); call.current = null; onActive(false); }, [sessionId]);
  const activate = async (conversation, expected, continuous) => {
    if (current.current !== expected) return;
    cleanup.current(); setCaption(""); setRecords(null); call.current = conversation;
    cleanup.current = conversation.controller.subscribe(() => {
      const snapshot = conversation.controller.getSnapshot();
      setView(snapshot);
      if (snapshot.inputLevel != null) setLevels((values) => [...values.slice(-15), snapshot.inputLevel]);
      onActive(snapshot.connection !== "closed");
    });
    await conversation.start({ sessionId: expected || null, continuous });
  };
  useEffect(() => {
    if (view?.capture !== "recording") return;
    const started = Date.now(); setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(timer);
  }, [view?.capture]);
  useEffect(() => {
    const pause = () => { if (document.hidden) void call.current?.controller.disconnect("voice_background"); };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);
  const start = async (selectedMode) => {
    setOpening(true); setError(null);
    try {
      const settings = await loadVoiceSettings({ force: true });
      const continuous = (selectedMode || settings.config.mode) === "continuous";
      if (settings.config.backend === "realtime" && continuous) {
        const conversation = createRealtimeConversation({ request, readAloud: settings.config.speak, idleTimeoutMs: settings.config.idleTimeoutMs, recoveryTimeoutMs: settings.config.recoveryTimeoutMs,
          device: captureSource("pc", settings.config.device),
          socket: (ticket) => {
            const url = new URL("/api/lares/voice/realtime", location.href); url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
            return new WebSocket(url, ["lares-voice", `lares-ticket.${ticket}`]);
          }, onCaption: (text) => setCaption((previous) => `${previous}${text}`.slice(-300)),
        });
        await activate(conversation, sessionId, true);
        return;
      }
      const expected = sessionId;
      const browser = createBrowserPlayer();
      let conversation;
      const reader = createSentencePlayer({
        send: (value) => conversation.speak(value).then((result) => ({ ...result, blob: result.audio ? wavBlob(result.audio) : null })),
        play: (sentence) => sentence.bluetooth === "played" ? Promise.resolve() : browser.play(sentence.blob),
        halt: browser.stop, silence: () => {},
        fail: (cause) => { setError(cause.code || cause.message); void conversation.controller.disconnect("voice_playback_failed"); },
        onState: (playing) => conversation?.playbackState(playing),
      });
      conversation = createVoiceConversation({ request, mode, device: captureSource("pc", settings.config.device),
        readAloud: continuous && settings.config.speak,
        preset: settings.config.preset, endpointSilenceMs: settings.config.endpointSilenceMs, idleTimeoutMs: settings.config.idleTimeoutMs, recoveryTimeoutMs: settings.config.recoveryTimeoutMs,
        onText: (text) => setCaption(text),
        onTranscript: continuous && settings.config.preset !== "dictation" ? null : ({ text }) => {
          if (current.current !== expected) return;
          const value = draftRef.current;
          const span = inputActions?.captureInsertion();
          if (!span || !inputActions.insertText(`${value && !/\s$/.test(value) ? " " : ""}${text}`, { ...span, start: value.length, end: value.length })) {
            setCaption(text); throw new Error("voice_draft_changed");
          }
        },
        transcribe: async (blob, signal) => {
          const response = await fetch("/api/lares/voice/transcribe", { method: "POST", body: blob, headers: { "content-type": blob.type }, signal });
          const value = await response.json(); if (!response.ok) throw new Error(value.error?.code || "voice_failed"); return value.text;
        }, playback: { stop() { reader.stop(); browser.stop(); } },
        onReply: (reply) => { const target = speakable(reply, settings.config.streaming); if (target) reader.follow(target); },
      });
      await activate(conversation, expected, continuous);
    } catch (cause) { setError(cause.message); void call.current?.stop().catch(() => {}); onActive(false); }
    finally { setOpening(false); }
  };
  const active = view?.connection === "open";
  const paused = view?.connection === "paused";
  const recording = view?.capture === "recording";
  const single = active && !view?.continuous;
  const control = (label, action, disabled = false) => h("button", { type: "button", className: "lares-voice-control", disabled, "aria-label": label, title: label,
    onClick: () => Promise.resolve().then(action).catch((cause) => setError(cause.message)) }, label);
  return h("span", { className: "lares-voice-controls lares-voice-call-controls" },
    !active && !paused ? h(React.Fragment, null,
      ...[defaultMode, defaultMode === "continuous" ? "single" : "continuous"].map((choice) => control(t(choice === "single" ? "mic.idle" : "call.start"), () => start(choice), opening))) : null,
    single ? h(React.Fragment, null,
      control(t("mic.cancel"), () => call.current.stop()),
      recording ? h("span", { className: "lares-voice-live" }, h("span", { className: "lares-voice-dot" }), `${elapsed}s`,
        levels.length ? h("svg", { width: 64, height: 24, "aria-hidden": true }, ...levels.map((level, index) => h("line", { key: index, x1: index * 4, x2: index * 4, y1: 12 - Math.min(11, level * 800), y2: 12 + Math.min(11, level * 800), stroke: "currentColor", strokeWidth: 2 }))) : null) : null,
      recording ? control(t("mic.finish"), () => call.current.controller.stopRecording()) : null) : null,
    active && view.continuous ? h(React.Fragment, null,
      control(t(view.outputMuted ? "call.unmute" : "call.mute"), () => call.current.setReadAloud(view.outputMuted)),
      control(t(view.inputPaused ? "call.resumeInput" : "call.pauseInput"), () => view.inputPaused ? call.current.controller.resumeInput() : call.current.controller.pauseInput()),
      view.playback !== "idle" ? control(t("call.stopPlayback"), () => call.current.controller.stopPlayback()) : null,
      control(t("call.end"), () => call.current.stop())) : null,
    paused ? h(React.Fragment, null, control(t("call.resume"), () => call.current.resume()), control(t("call.end"), () => call.current.stop())) : null,
    active && view.continuous && call.current?.records ? control(t("call.history"), async () => setRecords(await call.current.records())) : null,
    records ? h("details", { open: true, className: "lares-voice-history" }, h("summary", null, t("call.history")),
      ...records.records.map((row) => h("p", { key: row.id }, `${row.role}: ${row.text}`)),
      control(t("call.clearHistory"), async () => { await call.current.clearRecords(); setRecords(null); })) : null,
    caption ? h("span", { className: "lares-voice-caption" }, caption) : null,
    h("span", { role: "status", "aria-live": "polite" }, error || view?.error ? messageFor(t, error || view.error) : opening ? t("mic.preparing") : active ? [
      view.capture === "transcribing" ? t("mic.transcribing") : recording ? t("call.listening") : view.inputPaused ? t("call.inputPaused") : view.playback !== "idle" ? t("call.halfDuplex") : t("call.waiting"),
      view.playback !== "idle" ? t("call.speaking") : "",
    ].filter(Boolean).join(" · ") : ""),
  );
}
