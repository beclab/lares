import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { VoiceError } from "../router/stt.js";
import { askAgent, liveAgent, voiceDir } from "./agent.js";

const CAPTURE_FILE = "capture.s16";

/**
 * Play speech on the host that owns the headset.
 * No agent means this machine has no speaker to drive.
 */
export async function playBluetoothAudio(bytes, options = {}) {
  if (!await liveAgent(options)) return { played: false, skipped: true };
  const dir = voiceDir(options);
  const id = options.id ?? randomUUID();
  const file = `speech-${id}.wav`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/${file}`, bytes);
  const result = await askAgent("play", { file }, { ...options, id, timeoutMs: options.timeoutMs ?? 20_000 });
  if (result.skipped) return { played: false, skipped: true };
  if (result.playing) return { played: true, sink: result.sink };
  throw new VoiceError("voice_failed", 502, result.error || "speaker did not play");
}

/**
 * Open the host speaker so PCM can be written while later sentences are still synthesizing.
 * No agent means there is no headset speaker.
 */
export async function openBluetoothPlayback(options = {}) {
  if (!await liveAgent(options)) return { skipped: true };
  const dir = voiceDir(options);
  const id = options.id ?? randomUUID();
  const file = `speech-${id}.pcm`;
  const result = await askAgent("play-stream", { file, rate: 24000, channels: 1 }, {
    ...options,
    id,
    timeoutMs: options.timeoutMs ?? 20_000,
  });
  if (result.skipped) return { skipped: true };
  if (!result.playing) {
    throw new VoiceError("voice_failed", 502, result.error || "speaker did not play");
  }
  if (options.writer) return { skipped: false, sink: result.sink, ...options.writer };
  const stream = createWriteStream(`${dir}/${file}`);
  const ready = new Promise((resolve, reject) => {
    stream.once("open", resolve);
    stream.once("error", reject);
  });
  return {
    skipped: false,
    sink: result.sink,
    async write(chunk) {
      await ready;
      if (!stream.write(chunk)) await once(stream, "drain");
    },
    async close() {
      await ready;
      await new Promise((resolve, reject) => {
        stream.once("finish", resolve);
        stream.once("error", reject);
        stream.once("close", () => {
          if (!stream.writableFinished) reject(new Error("speaker stream closed"));
        });
        stream.end();
      });
    },
    abort() {
      stream.destroy();
    },
  };
}

/** Stop a readout without changing the headset microphone profile. */
export async function stopBluetoothPlayback(options = {}) {
  if (!await liveAgent(options)) return { stopped: false, skipped: true };
  const result = await askAgent("playback-stop", {}, options);
  return { stopped: result.stopped === true };
}

/** Start the headset recording on the machine. No agent means there is no headset mic. */
export async function beginHostCapture(options = {}) {
  if (!await liveAgent(options)) return { skipped: true };
  const result = await askAgent("capture-start", {}, options);
  if (result.skipped) return { skipped: true };
  if (!result.ready) {
    throw new VoiceError("voice_bluetooth_not_ready", 503, result.error || "bluetooth headset is not capturing");
  }
  return {
    ready: true,
    file: result.file || CAPTURE_FILE,
    offset: Number(result.offset) || 0,
    settle: result.settle === true,
  };
}

/** Bytes written after `from`. The call link stays open, so the file keeps growing. */
export async function readHostCapture(from = 0, options = {}) {
  const start = Number.isFinite(from) ? Math.max(0, Math.trunc(from)) : 0;
  let handle;
  try {
    handle = await open(`${voiceDir(options)}/${CAPTURE_FILE}`, "r");
    const { size } = await handle.stat();
    const length = size - start;
    if (length <= 0) return Buffer.alloc(0);
    const buf = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buf, 0, length, start);
    return bytesRead === buf.length ? buf : buf.subarray(0, bytesRead);
  } catch {
    return Buffer.alloc(0);
  } finally {
    await handle?.close();
  }
}

export async function endHostCapture(options = {}) {
  if (!await liveAgent(options)) return { ready: true, skipped: true };
  await askAgent("capture-stop", {}, options);
  return { ready: true };
}

/** Recreate a capture transport that produced no microphone samples. */
export async function resetHostCapture(options = {}) {
  if (!await liveAgent(options)) return { ready: true, skipped: true };
  await askAgent("capture-reset", {}, options);
  return { ready: true };
}
