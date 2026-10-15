import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { VoiceError } from "../router/stt.js";

const DEFAULT_DIR = "/data/voice";
const WAIT_MS = 30_000;
const AGENT_STALE_MS = 60_000;

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function agentIsLive(info, now) {
  return Boolean(info && typeof info.at === "number" && now - info.at * 1000 < AGENT_STALE_MS);
}

export function voiceDir(options) {
  return options.dir ?? process.env.LARES_VOICE_BLUETOOTH_DIR ?? DEFAULT_DIR;
}

/** The host agent, or null when this machine has no bluetooth helper running. */
export async function liveAgent(options = {}) {
  const now = options.now ?? Date.now;
  const info = await readJson(`${voiceDir(options)}/agent.json`);
  return agentIsLive(info, now()) ? info : null;
}

export async function askAgent(op, fields, options) {
  const dir = voiceDir(options);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  if (!await liveAgent(options)) {
    throw new VoiceError("voice_bluetooth_unavailable", 503, "bluetooth agent is not running");
  }
  const id = options.id ?? randomUUID();
  await mkdir(dir, { recursive: true });
  await rm(`${dir}/result.json`, { force: true });
  await writeFile(`${dir}/request.json`, JSON.stringify({ id, op, ...fields }));
  const deadline = now() + (options.timeoutMs ?? WAIT_MS);
  while (now() < deadline) {
    const result = await readJson(`${dir}/result.json`);
    if (result && result.id === id) return result;
    await sleep(200);
  }
  throw new VoiceError("voice_bluetooth_unavailable", 503, "bluetooth agent did not answer");
}
