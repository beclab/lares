import { captureSource } from "@olares/lares-core/voice/input";
import { createRealtimeConversation } from "@olares/lares-core/voice/realtime-conversation";
import React from "react";
import { createVoiceConversation } from "@olares/lares-core/voice/conversation";
import { createBrowserPlayer } from "@olares/lares-core/voice/browser-playback";
import { createSentencePlayer, speakable } from "@olares/lares-core/voice/speech";
import { loadVoiceSettings, wavBlob } from "@olares/lares-core/voice/client";
import { MicGlyph } from "./icons.js";
import { useT, messageFor } from "./locale.js";
import micCss from "./styles/mic.css";
export { micCss };
const h = React.createElement;
const { useEffect, useRef, useState } = React;
const request = async (url, options = {}) => {
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...options.headers }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  return { ok: response.ok, body: await response.json() };
};
export function MicButton({ sessionId, onActive = () => {}, mode = () => "queue" }) {
  const t = useT();
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [caption, setCaption] = useState("");
  const [opening, setOpening] = useState(false);
  const call = useRef(null);
  const cleanup = useRef(() => {});
  const current = useRef(sessionId);
  current.current = sessionId;
  useEffect(() => () => { cleanup.current(); void call.current?.stop().catch(() => {}); call.current = null; onActive(false); }, [sessionId]);
  const activate = async (conversation, expected, continuous) => {
    if (current.current !== expected) return;
    cleanup.current(); call.current = conversation;
    cleanup.current = conversation.controller.subscribe(() => {
      const snapshot = conversation.controller.getSnapshot();
      setView(snapshot); onActive(snapshot.connection !== "closed");
    });
    await conversation.start({ sessionId: expected || null, continuous });
  };
  const start = async () => {
    setOpening(true); setError(null);
    try {
      const settings = await loadVoiceSettings({ force: true });
      if (settings.config.backend === "realtime") {
        const conversation = createRealtimeConversation({ request,
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
        readAloud: settings.config.mode === "continuous" || settings.config.speak,
        transcribe: async (blob, signal) => {
          const response = await fetch("/api/lares/voice/transcribe", { method: "POST", body: blob, headers: { "content-type": blob.type }, signal });
          const value = await response.json(); if (!response.ok) throw new Error(value.error?.code || "voice_failed"); return value.text;
        }, playback: { stop() { reader.stop(); browser.stop(); } },
        onReply: (reply) => { const target = speakable(reply, settings.config.streaming); if (target) reader.follow(target); },
      });
      await activate(conversation, expected, settings.config.mode === "continuous");
    } catch (cause) { setError(cause.message); void call.current?.stop().catch(() => {}); onActive(false); }
    finally { setOpening(false); }
  };
  const active = view?.connection === "open";
  const paused = view?.connection === "paused";
  const recording = view?.capture === "recording";
  const label = opening ? t("mic.preparing") : recording ? t("mic.stop") : active ? t("call.end") : t("call.start");
  return h("span", { className: "lares-voice-controls lares-voice-call-controls" },
    h("button", { type: "button", className: "lares-voice-mic", "data-connected": active || paused ? "true" : undefined, "data-phase": recording ? "recording" : "idle", disabled: opening, "aria-label": label, onClick: () => {
      if (paused) void call.current.resume().catch((cause) => setError(cause.message));
      else if (active && !view.continuous && recording) call.current.controller.stopRecording();
      else if (active) void call.current.stop().catch((cause) => setError(cause.message));
      else void start();
    } }, active ? t(view.continuous ? "call.end" : "mic.stop") : paused ? t("call.resume") : MicGlyph()),
    active && view.playback !== "idle" ? h("button", { type: "button", onClick: () => void call.current.controller.stopPlayback().catch((cause) => setError(cause.message)) }, t("call.stopPlayback")) : null,
    active && view.agent === "running" ? h("button", { type: "button", onClick: () => void call.current.controller.cancelTask().catch((cause) => setError(cause.message)) }, t("call.cancelTask")) : null,
    caption ? h("span", { className: "lares-voice-caption" }, caption) : null,
    h("span", { role: "status", "aria-live": "polite" }, error || view?.error ? messageFor(t, error || view.error) : active ? t(`call.${view.capture === "recording" ? "listening" : view.agent === "running" ? "working" : view.playback !== "idle" ? "speaking" : "waiting"}`) : ""),
  );
}
