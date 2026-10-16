import { transcribe } from "../router/stt.js";
import { pcmToWav, synthesize } from "../router/tts.js";
import { normalizeSttPcm } from "./pcm.js";
import { createPcmResampler, pcmSamples } from "./realtime-audio.js";

export function wavData(wav) {
  for (let offset = 12; offset + 8 <= wav.length;) {
    const length = wav.readUInt32LE(offset + 4);
    if (offset + 8 + length > wav.length) throw new Error("voice_audio_format");
    if (wav.toString("ascii", offset, offset + 4) === "data") return wav.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length + length % 2;
  }
  throw new Error("voice_audio_format");
}

export function createRouterAudio(config) {
  return {
    transcribe: (pcm, scope) => transcribe({ bytes: pcmToWav(pcm, 24000), filename: "voice.wav", contentType: "audio/wav", model: config().model || "default-stt", language: config().language || undefined, signal: scope.voiceAbort?.signal, once: true }),
    async synthesize(text, scope) {
      const settings = config();
      const wav = await synthesize({ text, model: settings.ttsModel || "default-tts", voice: settings.voice || undefined, signal: scope.outputAbort?.signal });
      const normalized = await normalizeSttPcm(wav, "audio/wav");
      return Buffer.from(createPcmResampler(16000)(pcmSamples(wavData(normalized))));
    },
  };
}
