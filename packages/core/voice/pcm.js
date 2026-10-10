import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VoiceError } from "../router/stt.js";

/** Parakeet transcribes 16 kHz mono PCM. 48 kHz browser captures come back as a short wrong word. */
export const STT_SAMPLE_RATE = 16_000;
const PREPARE_TIMEOUT_MS = 30_000;

const INPUT_EXT = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
};

export function sttInputExtension(contentType) {
  const base = String(contentType ?? "").split(";", 1)[0].trim().toLowerCase();
  return INPUT_EXT[base] ?? "bin";
}

export function sttPcmArgs(inputPath, outputPath) {
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-i", inputPath,
    "-ac", "1",
    "-ar", String(STT_SAMPLE_RATE),
    "-c:a", "pcm_s16le",
    "-f", "wav",
    outputPath,
  ];
}

function assertSttWav(wav) {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new VoiceError("voice_audio_unreadable", 400, "audio could not be prepared");
  }
  if (wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 1 || wav.readUInt32LE(24) !== STT_SAMPLE_RATE || wav.readUInt16LE(34) !== 16) {
    throw new VoiceError("voice_audio_unreadable", 400, "audio could not be prepared");
  }
}

function runFfmpeg(ffmpegBin, args, spawnFn) {
  return new Promise((resolve, reject) => {
    const child = spawnFn(ffmpegBin, args, { stdio: ["ignore", "ignore", "pipe"] });
    const errors = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, PREPARE_TIMEOUT_MS);
    child.stderr?.on("data", (chunk) => {
      errors.push(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const detail = Buffer.concat(errors).toString("utf8").trim().slice(-300);
      reject(new Error(detail || `ffmpeg exited ${code}`));
    });
  });
}

/**
 * Decode whatever the browser recorded into the one PCM layout the speech model accepts.
 * @param {Buffer} bytes
 * @param {string} [contentType]
 * @param {{ spawnFn?: typeof spawn, ffmpegBin?: string }} [options]
 * @returns {Promise<Buffer>}
 */
export async function normalizeSttPcm(bytes, contentType, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "lares-stt-"));
  const inputPath = join(dir, `in.${sttInputExtension(contentType)}`);
  const outputPath = join(dir, "out.wav");
  try {
    await writeFile(inputPath, bytes);
    await runFfmpeg(options.ffmpegBin ?? "ffmpeg", sttPcmArgs(inputPath, outputPath), options.spawnFn ?? spawn);
    const wav = await readFile(outputPath);
    assertSttWav(wav);
    return wav;
  } catch (err) {
    if (err instanceof VoiceError) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    throw new VoiceError("voice_audio_unreadable", 400, detail || "audio could not be prepared");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
