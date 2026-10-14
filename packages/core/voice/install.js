import { spawn } from "node:child_process";
import { VoiceError } from "../router/stt.js";

/** Charts the voice panel installs, stops, and resumes through olares-cli market. */
export const VOICE_CHARTS = {
  stt: { app: "audioqwen3asr06v3", version: "1.0.0", model: "Qwen3-ASR-0.6B" },
  tts: { app: "audioqwen3tts06v3", version: "1.0.0", model: "Qwen3-TTS-12Hz-0.6B-CustomVoice" },
};

const OUTPUT_LIMIT = 8000;

function chartFor(kind) {
  const chart = VOICE_CHARTS[kind];
  if (!chart) throw new VoiceError("voice_config_invalid", 400, "unknown voice chart");
  return chart;
}

/**
 * Market row → what the install button should do next.
 * `running` (and a stop that did not release the app) offers 停用.
 * `stopped` offers 启用. Anything still in flight stays on 安装中.
 * @param {Record<string, unknown> | null | undefined} row
 */
export function chartPhase(row) {
  if (!row || typeof row !== "object") return "absent";
  const state = typeof row.state === "string" ? row.state : "";
  if (!state || state === "uninstalled") return "absent";
  if (state === "running" || state === "stopFailed") return "running";
  if (state === "stopped") return "stopped";
  if (state.endsWith("Failed") || state.endsWith("Canceled")) return "failed";
  return "busy";
}

/** Model id Router registered for this chart, if the catalog has one. */
export function chartModelId(kind, ids) {
  const chart = VOICE_CHARTS[kind];
  if (!chart) return null;
  const list = (Array.isArray(ids) ? ids : []).map((id) => String(id ?? ""));
  return list.find((id) => id === chart.app || id.startsWith(`${chart.app}/`) || id.includes(chart.model)) ?? null;
}

function describe(chart, row) {
  return {
    app: chart.app,
    phase: chartPhase(row),
    state: typeof row?.state === "string" ? row.state : "",
  };
}

function runMarket(args, spawnFn) {
  return new Promise((resolve, reject) => {
    const child = spawnFn("olares-cli", args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const take = (bucket) => (chunk) => {
      if (bucket === "stdout") stdout = `${stdout}${chunk}`.slice(-OUTPUT_LIMIT);
      else stderr = `${stderr}${chunk}`.slice(-OUTPUT_LIMIT);
    };
    child.stdout?.on("data", take("stdout"));
    child.stderr?.on("data", take("stderr"));
    child.on("error", (error) => {
      reject(new VoiceError("voice_install_failed", 502, error.message));
    });
    child.on("close", (code) => {
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {
        json = null;
      }
      const text = `${stdout}\n${stderr}`;
      const message = (json && typeof json.message === "string" && json.message.trim())
        || stderr.trim()
        || stdout.trim()
        || `olares-cli exited ${code}`;
      resolve({ code: code ?? 1, json, text, message });
    });
  });
}

function accepted(result) {
  if (/already installed/i.test(result.text)) return true;
  if (result.code !== 0) return false;
  return result.json?.status !== "failed";
}

/**
 * Install from the profile's market catalog. Returns once Market accepts;
 * weight download continues, and status then reports `busy` until `running`.
 * @param {"stt" | "tts"} kind
 * @param {{ spawnFn?: typeof spawn }} [options]
 */
export async function installVoiceChart(kind, options = {}) {
  const chart = chartFor(kind);
  const spawnFn = options.spawnFn ?? spawn;
  const result = await runMarket(
    ["market", "install", chart.app, "-s", "market.test", "--version", chart.version, "--compute-mode", "nvidia", "-o", "json"],
    spawnFn,
  );
  if (!accepted(result)) {
    throw new VoiceError("voice_install_failed", 502, result.message);
  }
  return { app: chart.app, version: chart.version };
}

/** @param {"stt" | "tts"} kind */
export async function voiceChartStatus(kind, options = {}) {
  const chart = chartFor(kind);
  const result = await runMarket(
    ["market", "status", chart.app, "-a", "-o", "json"],
    options.spawnFn ?? spawn,
  );
  if (!result.json) throw new VoiceError("voice_install_failed", 502, result.message);
  return describe(chart, result.json);
}

export async function voiceChartsStatus(options = {}) {
  const [stt, tts] = await Promise.all([
    voiceChartStatus("stt", options),
    voiceChartStatus("tts", options),
  ]);
  return { stt, tts };
}

async function settle(kind, verb, code, options) {
  const chart = chartFor(kind);
  const result = await runMarket(
    ["market", verb, chart.app, "--watch", "-o", "json"],
    options.spawnFn ?? spawn,
  );
  if (!accepted(result)) throw new VoiceError(code, 502, result.message);
  return voiceChartStatus(kind, options);
}

/** Stop the chart and let Market release its memory and GPU. */
export function stopVoiceChart(kind, options = {}) {
  return settle(kind, "stop", "voice_stop_failed", options);
}

/** Start a stopped chart again. */
export function resumeVoiceChart(kind, options = {}) {
  return settle(kind, "resume", "voice_resume_failed", options);
}
