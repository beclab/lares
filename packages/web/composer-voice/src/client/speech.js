import React from "react";
import { loadVoiceSettings, postSpeak } from "./api.js";
import { browserPlays } from "@olares/lares-core/voice/playback";
import {
  emptySpeechState,
  matchSpeechEvent,
  reduceSpeechEvent,
} from "@olares/lares-core/voice/speech";

const { useEffect, useRef, useSyncExternalStore } = React;
const h = React.createElement;
const TARGET = "lares-voice-speech";

export const speechDefinition = {
  kind: TARGET,
  target: TARGET,
  match: matchSpeechEvent,
  start() {
    return emptySpeechState();
  },
  update(context, match) {
    return reduceSpeechEvent(context.state, match.event);
  },
  buildViewNode(context) {
    const text = context.state?.text?.trim();
    if (!text) return null;
    return {
      key: context.key,
      kind: context.kind,
      id: context.id,
      target: TARGET,
      data: { turn: Number(context.id), seq: context.state.seq, text },
    };
  },
};

function latestUtterance(nodes) {
  let best = null;
  for (const node of nodes) {
    const data = node?.data;
    if (!data?.text) continue;
    if (!best || data.seq >= best.seq) best = data;
  }
  return best;
}

export const speechView = {
  target: TARGET,
  create() {
    let snapshot = { latest: null };
    const publish = (latest) => {
      if (snapshot.latest?.seq === latest?.seq) return snapshot;
      snapshot = { latest };
      return snapshot;
    };
    return {
      empty: snapshot,
      replace({ nodes }) {
        return publish(latestUtterance(nodes));
      },
      apply({ upserts }) {
        return publish(latestUtterance(upserts) ?? snapshot.latest);
      },
    };
  },
};

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

/**
 * Speaks a turn only after this view has seen it open, and only when playback
 * is switched on. History that arrives already closed stays silent.
 */
export function SpeechPlayer({ sessionId, conversation }) {
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
  const spoken = useRef(new Set());
  const audioRef = useRef(null);

  useEffect(() => {
    if (typeof openTurn === "number") opened.current.add(openTurn);
  }, [openTurn]);

  useEffect(() => {
    const latest = speech?.latest;
    if (!latest?.text || spoken.current.has(latest.seq)) return;
    if (!opened.current.has(latest.turn)) return;
    let cancelled = false;
    let playing = false;
    void (async () => {
      const settings = await loadVoiceSettings().catch(() => null);
      if (cancelled || !settings?.config?.speak) return;
      const result = await postSpeak(latest.text).catch(() => null);
      if (cancelled || !result?.blob || spoken.current.has(latest.seq)) return;
      if (!browserPlays("pc", result.bluetooth)) {
        spoken.current.add(latest.seq);
        return;
      }
      const blob = result.blob;
      if (!blob) return;
      audioRef.current?.pause();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
      try {
        await audio.play();
        playing = true;
        spoken.current.add(latest.seq);
      } catch {
        URL.revokeObjectURL(url);
      }
    })();
    return () => {
      if (!playing) cancelled = true;
    };
  }, [speech]);

  return h("span", { hidden: true });
}
