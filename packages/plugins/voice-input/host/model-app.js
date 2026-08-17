/**
 * Provision Router STT model apps via `router app install` (not plain market install).
 * App id comes from the Router catalog; requires edge identity (OLARES_CLI_HOME).
 */
import { spawn } from "node:child_process";

const IDENTITY_HINT = "Olares 身份尚未就绪：先通过 Olares 入口打开一次 Dina，再安装语音应用";

const ACCEPT_TIMEOUT_MS = 60_000;
const CATALOG_TIMEOUT_MS = 30_000;
const STDOUT_LIMIT = 1024 * 1024;
const STDERR_TAIL = 4_000;

// Exclude TTS (`speech`); those rows break STT if selected as the model.
const STT_APP_HINTS = /whisper|\bstt\b|\basr\b|transcri/i;

export function identityReady() {
  return Boolean(process.env.OLARES_CLI_HOME?.trim() && process.env.HOME?.trim());
}

/** @param {string[]} args @param {number} timeoutMs */
function runCli(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn("olares-cli", args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let overflowed = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length + chunk.length > STDOUT_LIMIT) {
        overflowed = true;
        child.kill("SIGTERM");
        return;
      }
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL);
    });

    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (overflowed) reject(new Error(`olares-cli ${args.join(" ")} 输出过大`));
      else resolve({ code: code ?? -1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

/** @param {{ code: number, stdout: string, stderr: string }} result */
function diagnostic(result) {
  return result.stderr || result.stdout || `exit ${result.code}`;
}

/** @param {Array<Record<string, unknown>>} items */
export function pickSttApp(items) {
  for (const row of Array.isArray(items) ? items : []) {
    const app = String(row?.app_name ?? "").trim();
    if (!app) continue;
    const title = String(row?.title ?? "").trim();
    if (STT_APP_HINTS.test(`${app} ${title} ${row?.description ?? ""}`)) return { app, title: title || app };
  }
  return null;
}

export async function findSttApp() {
  if (!identityReady()) throw new Error(IDENTITY_HINT);
  const result = await runCli(["router", "app", "catalog", "-o", "json"], CATALOG_TIMEOUT_MS);
  if (result.code !== 0) throw new Error(`读取 Router 模型目录失败：${diagnostic(result)}`);
  try {
    return pickSttApp(JSON.parse(result.stdout)?.items);
  } catch {
    throw new Error("Router 模型目录返回了无法解析的内容");
  }
}

/**
 * Accept-only install (no --watch): weight download takes minutes; readiness is
 * observed from the Router catalog. CLI refusal text is surfaced verbatim.
 * @param {string} app
 */
export async function installSttApp(app) {
  if (!identityReady()) throw new Error(IDENTITY_HINT);
  const result = await runCli(["router", "app", "install", app], ACCEPT_TIMEOUT_MS);
  if (result.code !== 0) throw new Error(`安装语音应用 ${app} 失败：${diagnostic(result)}`);
}
