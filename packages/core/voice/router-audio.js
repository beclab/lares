import { WebSocket } from "ws";
import { ttsVoiceForModel } from "./tts-voice.js";
import { listModels, pickSttModelId, pickTtsModelId, transcribe } from "../router/stt.js";
import { routerAuthHeaders, routerGatewayUrl } from "../router/gateway.js";
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

// Router groups child requests of one Realtime session by this header (Router ADR-83).
const routerSession = (scope) => scope.routerSessionId ? { "x-session-id": scope.routerSessionId } : undefined;

export function createRouterAudio(config) {
  return {
    // Same resolution as the streaming path: a configured model that is not installed falls back to one that is.
    transcribe: async (pcm, scope) => transcribe({ bytes: pcmToWav(pcm, 24000), filename: "voice.wav", contentType: "audio/wav", model: pickSttModelId(await listModels(), config().model) || config().model || "default-stt", language: scope.voiceOverrides?.language || config().language || undefined, signal: scope.voiceAbort?.signal, once: true, headers: routerSession(scope) }),
    /**
     * Streaming ASR for one turn when the selected model supports it: 24 kHz PCM in,
     * partial transcripts out. Returns null so the caller keeps the batch path otherwise.
     */
    async openTranscription(scope, onPartial, { env = process.env } = {}) {
      const rows = await listModels();
      const settings = config();
      const model = pickSttModelId(rows, settings.model);
      if (!model || !rows.find((row) => row.id === model)?.supportsSttStream) return null;
      const socket = new WebSocket(`${routerGatewayUrl(env).replace(/^http/, "ws")}/audio/stream?model=${encodeURIComponent(model)}`, {
        headers: { ...routerAuthHeaders(env.LARES_ROUTER_API_KEY, env.OLARES_APP_ID, scope.owner), ...routerSession(scope) }, handshakeTimeout: 15_000, maxPayload: 96 * 1024 });
      const convert = createPcmResampler(24000, 16000);
      let text = "", settle;
      const final = new Promise((resolve, reject) => { settle = { resolve, reject }; });
      final.catch(() => {});
      const opened = new Promise((resolve, reject) => {
        socket.once("open", () => { socket.send(JSON.stringify({ type: "start", sample_rate: 16000, language: scope.voiceOverrides?.language || settings.language || undefined })); resolve(); });
        socket.once("error", reject);
      });
      opened.catch(() => {});
      socket.on("message", (raw, binary) => {
        if (binary) return;
        let value;
        try { value = JSON.parse(String(raw)); } catch { return; }
        if (value.type === "partial") { text = String(value.text || ""); onPartial(text); }
        if (value.type === "final") { text = String(value.text || ""); settle.resolve(text); }
        if (value.type === "error") settle.reject(new Error(value.code || "voice_stream_failed"));
      });
      socket.on("close", () => settle.reject(new Error("voice_stream_closed")));
      socket.on("error", () => settle.reject(new Error("voice_stream_failed")));
      let chain = opened;
      return {
        write(pcm) { chain = chain.then(() => { if (socket.readyState === 1) socket.send(Buffer.from(convert(pcmSamples(pcm)))); }); chain.catch(() => {}); },
        async finish() { await chain; socket.send(JSON.stringify({ type: "finish" })); try { return await final; } finally { socket.close(); } },
        cancel() { socket.terminate(); },
      };
    },
    async synthesize(text, scope, onChunk) {
      const settings = { ...structuredClone(config()), ...scope.voiceOverrides?.voice && { voice: scope.voiceOverrides.voice } };
      const model = pickTtsModelId(await listModels(), settings.ttsModel) || settings.ttsModel || "default-tts";
      const chunks = [];
      let convert = null;
      const write = async (pcm) => { if (onChunk) await onChunk(pcm); else chunks.push(pcm); };
      let pending = Buffer.alloc(0);
      const result = await synthesizeStream({ text, model, voice: settings.voice || ttsVoiceForModel(settings, model), signal: scope.outputAbort?.signal, headers: routerSession(scope),
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
