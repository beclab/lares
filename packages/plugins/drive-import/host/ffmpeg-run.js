import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import { ffmpegHwCandidates } from "./ffmpeg-hw.js";

const LOG_LIMIT = 32_000;
const STDERR_LIMIT = 2000;

export function parseFfmpegReport(log, fallbackEncoder) {
  const text = String(log ?? "");
  const speedMatch = [...text.matchAll(/\bspeed=\s*([0-9.]+)x\b/g)].at(-1);
  const encoderMatch = text.match(/\[(h264_vaapi|h264_nvenc|libx264)\s@/i)
    || text.match(/\bencoder:\s*(h264_vaapi|h264_nvenc|libx264)\b/i);
  return {
    encoder: encoderMatch?.[1] || fallbackEncoder,
    speed: speedMatch ? `${speedMatch[1]}x` : "",
  };
}

export function ffmpegEncodeArgv(job, hw, { overwrite = false } = {}) {
  const generated = Boolean(job.lavfi);
  const args = ["-hide_banner", overwrite ? "-y" : "-n"];
  if (hw.globalArgv) args.push(...hw.globalArgv);
  if (generated) {
    args.push("-f", "lavfi", "-i", job.lavfi);
  } else {
    if (hw.decodeArgv) args.push(...hw.decodeArgv);
    args.push("-i", job.inputAbsolute);
  }
  if (job.duration != null) args.push("-t", String(job.duration));
  args.push(...(hw.encodeArgv ?? []));
  if (!generated) args.push("-map", "0:v:0", "-map", "0:a:0?", "-c:a", "aac", "-b:a", "128k");
  const ext = extname(job.absolutePath).toLowerCase();
  if (ext === ".mp4" || ext === ".mov") args.push("-movflags", "+faststart");
  args.push(job.absolutePath);
  return args;
}

function collectLog(stream, limit) {
  let log = "";
  stream?.on("data", (chunk) => {
    log = `${log}${chunk}`.slice(-limit);
  });
  return () => log;
}

function ffmpegLogFailed(log) {
  return /File ['"].*['"] already exists/i.test(log)
    || /Conversion failed!/i.test(log)
    || /Error opening output file/i.test(log)
    || /Cannot load libcuda/i.test(log);
}

function runFfmpeg(args, {
  ffmpegBin = "ffmpeg",
  spawnFn = spawn,
  signal,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnFn(ffmpegBin, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      ...(signal ? { signal } : {}),
    });
    const stdout = collectLog(child.stdout, LOG_LIMIT);
    const stderr = collectLog(child.stderr, LOG_LIMIT);
    child.on("error", (error) => {
      reject(new Error(`ffmpeg failed: ${error.message}`));
    });
    child.on("close", (code) => {
      const log = `${stdout()}\n${stderr()}`;
      if (code === 0 && !ffmpegLogFailed(log)) {
        resolve(log);
        return;
      }
      reject(new Error(`ffmpeg exited ${code}: ${log.trim().slice(-STDERR_LIMIT) || "no output"}`));
    });
  });
}

export async function encodeWorkspaceVideo(job, {
  ffmpegBin = "ffmpeg",
  spawnFn = spawn,
  signal,
  candidates = ffmpegHwCandidates(),
} = {}) {
  let lastError;
  for (const [index, hw] of candidates.entries()) {
    try {
      const overwrite = job.overwrite || index > 0;
      if (!overwrite && existsSync(job.absolutePath)) {
        throw new Error(`${job.absolutePath} already exists; pass overwrite or choose another destination`);
      }
      const args = ffmpegEncodeArgv(job, hw, { overwrite });
      const log = await runFfmpeg(args, { ffmpegBin, spawnFn, signal });
      const info = statSync(job.absolutePath);
      if (!info.isFile() || info.size === 0) {
        throw new Error("ffmpeg wrote an empty file");
      }
      const report = parseFfmpegReport(log, hw.encoder);
      return {
        bytes: info.size,
        encoder: report.encoder,
        speed: report.speed || "",
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("ffmpeg encode failed");
}
