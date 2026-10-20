import { subscribeVoiceSettings } from "@olares/lares-core/larepass/settings";
import { readoutState } from "@olares/lares-core/voice/speech";
import { useT } from "./locale.js";
import { playAudioStream } from "@olares/lares-core/voice/stream-client";
import { voiceHeaders } from "@olares/lares-core/voice/client";
import { createBrowserPlayer } from "@olares/lares-core/voice/browser-playback";
import React from "react";
import { loadVoiceSettings, postPlaybackStop, postSpeak } from "./api.js";
import { browserPlays } from "@olares/lares-core/voice/playback";
import { createSentencePlayer, speakable } from "@olares/lares-core/voice/speech";
import { TARGET } from "./speech-view.js";

const { useEffect, useRef, useSyncExternalStore } = React;
const h = React.createElement;

function bindingOf(conversation, sessionId) {
  if (!conversation || sessionId == null || sessionId === "") return null;
  try {
    return conversation.binding(sessionId);
  } catch {
    return null;
  }
}

function speechSourceOf(binding) {
  if (!binding) return null;
  try {
    return binding.target(TARGET);
  } catch {
    return null;
  }
}


function createReader() {
  const browser = createBrowserPlayer();
  return createSentencePlayer({
    stream: (value) => playAudioStream({ ...value, headers: voiceHeaders(), request: async (path, options) => {
      const res = await fetch(path, { ...options, headers: { "content-type": "application/json", ...options.headers }, body: JSON.stringify(options.body) });
      return { ok: res.ok, body: await res.json() };
    } }),
    send: (request) => postSpeak(request),
    play: (sentence) => (browserPlays("pc", sentence.bluetooth) ? browser.play(sentence.blob) : Promise.resolve()),
    halt: browser.stop,
    silence: (source) => void postPlaybackStop(source).catch(() => {}),
  });
}

/**
 * Reads a turn's answer while it is written, only after this view has seen
 * the turn open, and only when playback is switched on. History that arrives
 * already closed stays silent.
 */
export function SpeechPlayer({ sessionId, conversation, suspended = false }) {
  const binding = bindingOf(conversation, sessionId);
  const openSource = binding?.openTurn;
  const speechSource = speechSourceOf(binding);
  const openTurn = useSyncExternalStore(
    (listener) => openSource?.subscribe(listener) ?? (() => {}),
    () => openSource?.getSnapshot(),
  );
  const speech = useSyncExternalStore(
    (listener) => speechSource?.subscribe(listener) ?? (() => {}),
    () => speechSource?.getSnapshot(),
  );
  const opened = useRef(new Set());
  const reader = useRef(null);
  reader.current ??= createReader();
  // Playback is checked once per utterance; the answer keeps streaming meanwhile.
  const allowed = useRef({ key: null, speak: null, streaming: false, latest: null });
  const follow = (gate) => {
    const target = gate.speak ? speakable(gate.latest, true) : null;
    if (target) reader.current.follow(target);
  };

  useEffect(() => {
    if (typeof openTurn === "number") { reader.current.stop(); opened.current.add(openTurn); }
  }, [openTurn]);

  useEffect(() => () => reader.current.stop(), [sessionId]);
  useEffect(() => subscribeVoiceSettings(value => {
    if (value.config?.speak !== true) { reader.current.stop(); allowed.current.speak = false; }
  }), []);
  useEffect(() => {
    const stop = () => reader.current.stop();
    const hidden = () => { if (document.hidden) stop(); };
    const escape = event => { if (event.key === "Escape" && !event.defaultPrevented && !event.target?.closest?.("[data-voice-shortcut-recorder]")) stop(); };
    document.addEventListener("visibilitychange", hidden); globalThis.addEventListener("offline", stop); globalThis.addEventListener("keydown", escape);
    return () => { document.removeEventListener("visibilitychange", hidden); globalThis.removeEventListener("offline", stop); globalThis.removeEventListener("keydown", escape); };
  }, []);

  useEffect(() => {
    const latest = speech?.latest;
    if (!latest || document.hidden || !opened.current.has(latest.turn)) return;
    const utterance = { ...latest, sessionId, source: { sessionId, turn: latest.turn, step: latest.step, attemptId: latest.attemptId }, key: `${sessionId}:${latest.key}` };
    if (suspended) {
      reader.current.stop();
      allowed.current = { key: utterance.key, speak: false, streaming: false, latest: utterance };
      return;
    }
    const gate = allowed.current;
    if (gate.key === utterance.key) {
      gate.latest = utterance;
      follow(gate);
      return;
    }
    allowed.current = { key: utterance.key, speak: null, streaming: false, latest: utterance };
    void loadVoiceSettings({ diagnostics: false })
      .then((settings) => {
        const current = allowed.current;
        if (current.key !== utterance.key) return;
        current.speak = Boolean(settings?.config?.speak);
        current.streaming = settings?.config?.streaming === true;
        follow(current);
      })
      .catch(() => {});
  }, [speech, suspended]);

  return h("span", { hidden: true });
}

export function SpeechStatus({ sessionId, turn, step }) {
  const t = useT();
  const value = useSyncExternalStore(readoutState.subscribe, readoutState.getSnapshot);
  if (!value || value.sessionId !== sessionId || value.turn !== turn || value.step !== step) return null;
  return h("div", { role: "status", className: "lares-readout" },
    h("span", null, t(`readout.${value.status}`)),
    h("button", { type: "button", onClick: value.stop }, t(value.status === "error" ? "readout.dismiss" : "readout.stop")));
}

export const speechCss = `
.lares-readout { display:flex; align-items:center; flex-wrap:wrap; gap:12px; padding-block:6px; color:var(--dsw-alias-content-secondary,#777); font-size:13px; }
.lares-readout button { appearance:none; font:inherit; color:inherit; background:transparent; border:1px solid var(--dsw-alias-border-default,#8885); border-radius:8px; padding:5px 10px; cursor:pointer; }
.lares-readout button:hover { background:var(--dsw-alias-interactive-bg-hover,#8881); }
.lares-readout button:focus-visible { outline:2px solid var(--dsw-alias-brand-default,#467cff); outline-offset:2px; }
`;
