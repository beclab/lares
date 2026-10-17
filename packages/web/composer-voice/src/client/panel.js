import { createVoicePanel } from "@olares/lares-core/voice/panel";
import { createVoiceConversation } from "@olares/lares-core/voice/conversation";
import { createBrowserPlayer } from "@olares/lares-core/voice/browser-playback";
import { createSentencePlayer, speakable } from "@olares/lares-core/voice/speech";
import { captureSource } from "@olares/lares-core/voice/input";
import { loadVoiceSettings, wavBlob } from "@olares/lares-core/voice/client";
import { createVoiceSettingsState } from "./settings-state.js";
export const request = async (url, options = {}) => {
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...options.headers }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  return { ok: response.ok, body: await response.json() };
};
export function createWebVoicePanel(onSession) {
  const panel = createVoicePanel({ onSession, manualTurns: false, inlineDictation: true,
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
  panel.settings = createVoiceSettingsState();
  return panel;
}
