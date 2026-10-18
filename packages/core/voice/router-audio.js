import { ttsVoiceForModel } from "./tts-voice.js";
import { transcribe } from "../router/stt.js";
import { pcmToWav, synthesizeStream } from "../router/tts.js";
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
    async synthesize(text, scope, onChunk) {
      const settings = structuredClone(config());
      const model = settings.ttsModel || "default-tts";
      const chunks = [];
      let convert = null;
      const write = async (pcm) => { if (onChunk) await onChunk(pcm); else chunks.push(pcm); };
      let pending = Buffer.alloc(0);
      const result = await synthesizeStream({ text, model, voice: settings.voice || ttsVoiceForModel(settings, model), signal: scope.outputAbort?.signal,
        onFormat: (format) => { convert = createPcmResampler(format.sampleRate, 24000); },
      }, async (chunk) => {
        const joined = Buffer.concat([pending, chunk]);
        const end = joined.length - joined.length % 2;
        pending = joined.subarray(end);
        if (end) await write(Buffer.from(convert(pcmSamples(joined.subarray(0, end)))));
      });
      if (pending.length) throw new Error("voice_audio_format");
      if (!result.streamed) {
        const normalized = await normalizeSttPcm(result.audio, "audio/wav");
        await write(Buffer.from(createPcmResampler(16000, 24000)(pcmSamples(wavData(normalized)))));
      }
      return onChunk ? null : Buffer.concat(chunks);
    },
  };
}
