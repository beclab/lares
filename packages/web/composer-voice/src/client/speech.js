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
    send: (request) => postSpeak(request),
    play: (sentence) => (browserPlays("pc", sentence.bluetooth) ? browser.play(sentence.blob) : Promise.resolve()),
    halt: browser.stop,
    silence: () => void postPlaybackStop().catch(() => {}),
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
    const target = gate.speak ? speakable(gate.latest, gate.streaming) : null;
    if (target) reader.current.follow(target);
  };

  useEffect(() => {
    if (typeof openTurn === "number") opened.current.add(openTurn);
  }, [openTurn]);

  useEffect(() => () => reader.current.stop(), [sessionId]);

  useEffect(() => {
    const latest = speech?.latest;
    if (!latest || !opened.current.has(latest.turn)) return;
    const utterance = { ...latest, key: `${sessionId}:${latest.key}` };
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
    void loadVoiceSettings()
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
