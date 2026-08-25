import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { extname } from "node:path";

const LOG_LIMIT = 32_000;
const STDERR_LIMIT = 2000;
const SUBTITLE_STYLE = "FontName=Noto Sans CJK SC,FontSize=20,Outline=2,Shadow=0,MarginV=28";
const EVEN_DIMENSIONS = "pad=ceil(iw/2)*2:ceil(ih/2)*2";
const LIBX264_ARGV = [
  "-c:v", "libx264",
  "-preset", "veryfast",
  "-crf", "23",
  "-pix_fmt", "yuv420p",
];

export function parseFfmpegReport(log, fallbackEncoder = "libx264") {
  const text = String(log ?? "");
  const speedMatch = [...text.matchAll(/\bspeed=\s*([0-9.]+)x\b/g)].at(-1);
  const encoderMatch = text.match(/\[(libx264)\s@/i)
    || text.match(/\bencoder:\s*(libx264)\b/i);
  return {
    encoder: encoderMatch?.[1] || fallbackEncoder,
    speed: speedMatch ? `${speedMatch[1]}x` : "",
  };
}

function escapeFilterValue(value) {
  return String(value).replace(/([\\':,\[\];=\s])/g, "\\$1");
}

export function subtitleFilter(absolutePath) {
  return `subtitles=filename=${escapeFilterValue(absolutePath)}:force_style='${SUBTITLE_STYLE}'`;
}

export function ffmpegEncodeArgv(job, { overwrite = false } = {}) {
  const generated = Boolean(job.lavfi);
  const args = ["-hide_banner", overwrite ? "-y" : "-n"];
  if (generated) {
    args.push("-f", "lavfi", "-i", job.lavfi);
  } else {
    args.push("-i", job.inputAbsolute);
  }
  if (job.duration != null) args.push("-t", String(job.duration));
  const filters = [];
  if (!generated) filters.push(EVEN_DIMENSIONS);
  if (job.subtitlesAbsolute) filters.push(subtitleFilter(job.subtitlesAbsolute));
  if (filters.length > 0) args.push("-vf", filters.join(","));
  args.push(...LIBX264_ARGV);
  if (!generated) args.push("-map", "0:v:0", "-map", "0:a:0?", "-c:a", "aac", "-b:a", "128k");
  const ext = extname(job.absolutePath).toLowerCase();
  if (ext === ".mp4") args.push("-movflags", "+faststart");
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
    || /Error opening output file/i.test(log);
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
} = {}) {
  if (!job.overwrite && existsSync(job.absolutePath)) {
    throw new Error(`${job.absolutePath} already exists; pass overwrite or choose another destination`);
  }
  const args = ffmpegEncodeArgv(job, { overwrite: Boolean(job.overwrite) });
  const log = await runFfmpeg(args, { ffmpegBin, spawnFn, signal });
  const info = statSync(job.absolutePath);
  if (!info.isFile() || info.size === 0) {
    throw new Error("ffmpeg wrote an empty file");
  }
  const report = parseFfmpegReport(log);
  return {
    bytes: info.size,
    encoder: report.encoder,
    speed: report.speed || "",
  };
}
