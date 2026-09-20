import { spawn } from "node:child_process";
import { parseFilesPath } from "./files-path.js";

const STDERR_LIMIT = 2000;
const STDOUT_LIMIT = 64 * 1024;
const CAT_TIMEOUT_MS = 8_000;

function lookupError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Read one files-backend file as UTF-8 text (`olares-cli files cat`).
 * Identity is already in `process.env`.
 * @param spawnFn - seam for tests; the real spawn otherwise.
 */
export function runOlaresCat(source, options = {}) {
  const path = parseFilesPath(source);
  const { spawnFn = spawn } = options;
  const timeout = AbortSignal.timeout(CAT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  return new Promise((resolve, reject) => {
    const child = spawnFn("olares-cli", ["files", "cat", path], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      ...(signal ? { signal } : {}),
    });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    child.stdout?.on("data", (chunk) => {
      if (truncated) return;
      stdout += chunk;
      if (stdout.length > STDOUT_LIMIT) {
        truncated = true;
        stdout = "";
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-STDERR_LIMIT);
    });
    child.on("error", (error) => {
      reject(lookupError("files_unavailable", `olares-cli files cat failed: ${error.message}`));
    });
    child.on("close", (code) => {
      if (truncated) {
        reject(lookupError("files_unavailable", "olares-cli files cat output exceeded the read limit"));
        return;
      }
      if (code !== 0) {
        reject(lookupError(
          "files_unavailable",
          `olares-cli files cat exited ${code}: ${stderr.trim() || "no output"}`,
        ));
        return;
      }
      resolve(stdout);
    });
  });
}
