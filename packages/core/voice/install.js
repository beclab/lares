import { spawn } from "node:child_process";
import { VoiceError } from "../router/stt.js";

/** Charts this panel installs when Router has no model of that kind yet. */
export const VOICE_CHARTS = {
  stt: { app: "parakeet", version: "0.1.0" },
  tts: { app: "kokoro", version: "0.1.0" },
};

const OUTPUT_LIMIT = 2000;

/**
 * Ask Market to install the uploaded chart. The CLI returns once the install
 * is accepted; weight download continues after that.
 * @param {"stt" | "tts"} kind
 * @param {{ spawnFn?: typeof spawn }} [options]
 */
export function installVoiceChart(kind, options = {}) {
  const chart = VOICE_CHARTS[kind];
  if (!chart) throw new VoiceError("voice_config_invalid", 400, "unknown voice chart");
  const spawnFn = options.spawnFn ?? spawn;
  return new Promise((resolve, reject) => {
    const child = spawnFn(
      "olares-cli",
      ["market", "install", chart.app, "-s", "upload", "--version", chart.version, "--compute-mode", "nvidia"],
      { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    const take = (chunk) => {
      output = `${output}${chunk}`.slice(-OUTPUT_LIMIT);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    child.on("error", (error) => {
      reject(new VoiceError("voice_install_failed", 502, error.message));
    });
    child.on("close", (code) => {
      if (code === 0 || /already installed/i.test(output)) {
        resolve({ app: chart.app, version: chart.version });
        return;
      }
      reject(new VoiceError("voice_install_failed", 502, output.trim() || `install exited ${code}`));
    });
  });
}
