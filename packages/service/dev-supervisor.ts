import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Hot-reload supervisor for the hostPath dev overlay. node --watch relies on
// inotify, which does not fire for files rsync writes from the host into a
// hostPath mount. We poll a sentinel's mtime instead and re-exec the server.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, "index.js");
const RELOAD_FILE = process.env.DINA_RELOAD_FILE || path.resolve(HERE, "../..", ".dina-reload");
const POLL_MS = Number(process.env.DINA_RELOAD_POLL_MS || "1000");

/** mtime of the sentinel, or -1 while it does not exist. */
function readMtime(): number {
  try {
    return statSync(RELOAD_FILE).mtimeMs;
  } catch {
    return -1;
  }
}

let child: ReturnType<typeof spawn> | null = null;
let stopping = false;
let restarting = false;
let restartPending = false;
// Seeded before the first poll: a fresh install starts without the sentinel, so
// the first sync creates it — that creation is a reload signal, not a baseline.
let lastMtime = readMtime();

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
  if (current && current.exitCode === null && current.signalCode === null) {
    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        try {
          current.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }, 800);
      current.once("exit", () => {
        clearTimeout(killTimer);
        resolve();
      });
      if (!current.kill("SIGTERM")) {
        clearTimeout(killTimer);
        resolve();
      }
    });
  }
  stopping = false;
  start();
}

async function requestRestart() {
  if (restarting) {
    restartPending = true;
    return;
  }
  restarting = true;
  try {
    do {
      restartPending = false;
      await restart();
    } while (restartPending);
  } finally {
    restarting = false;
  }
}

function poll() {
  const mtime = readMtime();
  if (mtime === lastMtime) return;
  lastMtime = mtime;
  if (mtime < 0) return;
  console.log("[dina] reload signal → restarting dsh web");
  void requestRestart();
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
