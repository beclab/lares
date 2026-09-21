import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Hot reload is a runtime switch, not an install-time chart value. The chart
// always mounts the appData overlay at LARES_DEV_OVERLAY and always starts the
// image copy of this file, so switching modes is creating or deleting the flag
// file plus a pod restart (scripts/dev-sync/hot-reload.sh) — no repackaging,
// no reinstall. Read once at boot: an off install must not pay for polling.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMAGE_ROOT = path.resolve(HERE, "../..");
const OVERLAY = process.env.LARES_DEV_OVERLAY || "/devsrc";
const FLAG_NAME = ".hotreload";
const FLAG_FILE = path.join(OVERLAY, FLAG_NAME);
const ACTIVE_FILE = "/tmp/lares-hot-reload-active";
const RELOAD_ACK_FILE = "/tmp/lares-hot-reload-ack";
const IMAGE_STAMP = path.join(IMAGE_ROOT, ".lares-image-id");
const OVERLAY_STAMP = path.join(OVERLAY, ".lares-seeded-image-id");
const LOCK_STAMP = path.join(OVERLAY, ".lares-lock-sha");
const ENTRY = path.join(OVERLAY, "dist/service/index.js");

function readText(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Populate the overlay from the image on first enable and after an upgrade.
 * Lives here rather than in an initContainer so the chart carries no mode
 * logic at all; the app container's startupProbe covers the slow first copy.
 */
function seedOverlay(): void {
  const imageId = readText(IMAGE_STAMP);
  if (imageId === null) {
    throw new Error(`missing image identity: ${IMAGE_STAMP}`);
  }
  if (readText(OVERLAY_STAMP) === imageId) return;
  console.log(`[lares] seeding ${OVERLAY} from ${IMAGE_ROOT}`);
  rmSync(OVERLAY_STAMP, { force: true });
  for (const entry of readdirSync(OVERLAY)) {
    if (entry === FLAG_NAME) continue;
    rmSync(path.join(OVERLAY, entry), { recursive: true, force: true });
  }
  // cp keeps symlinks (node_modules/@olares/lares-core) and beats fs.cpSync on
  // a node_modules-sized tree over hostPath.
  const copy = spawnSync("cp", ["-a", `${IMAGE_ROOT}/.`, OVERLAY], { stdio: "inherit" });
  if (copy.status !== 0) {
    throw new Error(`seeding ${OVERLAY} failed (cp exited ${copy.status ?? copy.signal})`);
  }
  // This completion marker does not exist in /app, so an interrupted cp can
  // never make a partial overlay look complete on the next container start.
  writeFileSync(OVERLAY_STAMP, imageId);
  const lock = readFileSync(path.join(OVERLAY, "package-lock.json"));
  writeFileSync(LOCK_STAMP, createHash("sha256").update(lock).digest("hex"));
}

let child: ChildProcess | null = null;
let stopping = false;
let restarting = false;
let restartPending = false;
let acceptingHup = false;

/** index.js spawns dsh as a grandchild; kill the whole group so :8080 is freed. */
function killTree(target: ChildProcess, signal: NodeJS.Signals): boolean {
  if (target.pid == null) return false;
  try {
    process.kill(-target.pid, signal);
    return true;
  } catch {
    try {
      return target.kill(signal);
    } catch {
      return false;
    }
  }
}

function start() {
  child = spawn(process.execPath, [ENTRY], {
    stdio: "inherit",
    cwd: OVERLAY,
    env: process.env,
    detached: true,
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    process.exit(code ?? (signal ? 1 : 0));
  });
}

async function stopChild(signal: NodeJS.Signals): Promise<void> {
  const current = child;
  if (!current || current.exitCode !== null || current.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const killTimer = setTimeout(() => {
      killTree(current, "SIGKILL");
    }, 800);
    current.once("exit", () => {
      clearTimeout(killTimer);
      resolve();
    });
    if (!killTree(current, signal)) {
      clearTimeout(killTimer);
      resolve();
    }
  });
}

async function restart() {
  stopping = true;
  await stopChild("SIGTERM");
  stopping = false;
  start();
  writeFileSync(RELOAD_ACK_FILE, "");
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

/**
 * Supervise the overlay copy. Reload is pushed in: scripts/dev-sync/sync.sh
 * sends SIGHUP once the rsync lands. Watching the files instead would have to
 * poll, because inotify does not fire for host writes into a hostPath mount.
 */
function installSignals(): void {
  process.on("SIGHUP", () => {
    if (!acceptingHup) return;
    console.log("[lares] SIGHUP → restarting dsh web");
    void requestRestart();
  });
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      stopping = true;
      acceptingHup = false;
      void stopChild(sig).then(() => process.exit(0));
    });
  }
}

if (existsSync(FLAG_FILE)) {
  installSignals();
  seedOverlay();
  writeFileSync(ACTIVE_FILE, "");
  start();
  acceptingHup = true;
} else {
  rmSync(ACTIVE_FILE, { force: true });
  await import("./index.js");
}
