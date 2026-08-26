import { spawn } from "node:child_process";

/** Enough of a CLI failure to act on, without pulling a progress log into the turn. */
const STDERR_LIMIT = 2000;

/**
 * Stream one files-backend file onto local disk.
 *
 * The edge identity is already materialized into `process.env` (HOME /
 * OLARES_CLI_*) by `lares-olares-identity`, which is what the bash tool relies
 * on too, so the child inherits it rather than resolving a profile of its own.
 * @param spawnFn - seam for tests; the real spawn otherwise.
 */
export function runOlaresDownload(source, absolutePath, options = {}) {
  const { signal, overwrite = false, spawnFn = spawn } = options;
  return new Promise((resolve, reject) => {
    const args = ["files", "download", source, absolutePath];
    if (overwrite) args.push("--overwrite");
    const child = spawnFn("olares-cli", args, {
      env: process.env,
      stdio: ["ignore", "ignore", "pipe"],
      ...(signal ? { signal } : {}),
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-STDERR_LIMIT);
    });
    child.on("error", (error) => {
      reject(new Error(`olares-cli files download failed: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`olares-cli files download exited ${code}: ${stderr.trim() || "no output"}`));
    });
  });
}
