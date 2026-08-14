import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Hot-reload supervisor for the hostPath dev overlay. node --watch relies on
// inotify, which does not fire for files rsync writes from the host into a
// hostPath mount. We poll a sentinel's mtime instead and re-exec the server.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, "index.js");
const RELOAD_FILE = process.env.DINA_RELOAD_FILE || path.resolve(HERE, "..", ".dina-reload");
const POLL_MS = Number(process.env.DINA_RELOAD_POLL_MS || "1000");

let child: ReturnType<typeof spawn> | null = null;
let stopping = false;
let lastMtime = -1;

function start() {
  child = spawn(process.execPath, [ENTRY], { stdio: "inherit", env: process.env });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    process.exit(code ?? (signal ? 1 : 0));
  });
}

async function restart() {
  stopping = true;
  const current = child;
  if (current) {
    await new Promise<void>((resolve) => {
      current.once("exit", () => resolve());
      current.kill("SIGTERM");
      setTimeout(() => {
        try {
          current.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }, 800);
    });
  }
  stopping = false;
  start();
}

function poll() {
  let mtime = -1;
  try {
    mtime = statSync(RELOAD_FILE).mtimeMs;
  } catch {
    return;
  }
  if (lastMtime >= 0 && mtime !== lastMtime) {
    console.log("[dina] reload signal → restarting dsh web");
    void restart();
  }
  lastMtime = mtime;
}

start();
setInterval(poll, POLL_MS).unref();
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    stopping = true;
    if (child) child.kill(sig);
    process.exit(0);
  });
}
