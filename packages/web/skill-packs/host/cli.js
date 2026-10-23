import { spawn } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { HttpError } from "@olares/lares-core/tools/http";
import { HASS_PROFILE, connectionStatus, profileLoginArgs, scrubSecret } from "@olares/lares-core/skills/connection";
import { parseSkillNames } from "@olares/lares-core/skills/packs";
import { packCacheDir, writeExportedSkills } from "@olares/lares-core/skills/state";

const INSTALL_ATTEMPTS = 3;
const INSTALL_PAUSE_MS = 2_000;

function homePrefix() {
  const home = process.env.HOME?.trim() || homedir();
  return join(home, ".local");
}

export function cliBinPath(pack) {
  return join(homePrefix(), "bin", pack.cli.bin);
}

export function cliPresent(pack) {
  if (!pack?.cli?.bin) return true;
  return existsSync(cliBinPath(pack));
}

/**
 * npm only chmods a bin when it creates the symlink. A failed postinstall
 * leaves that link in place, so the next install extracts a mode-644 shim
 * and never repairs it. The prefix/bin entry has to be executable before
 * we treat the CLI as installed.
 */
export function repairCliBin(binPath) {
  if (!existsSync(binPath)) return false;
  try {
    chmodSync(binPath, 0o755);
  } catch {
    // A dangling symlink left by a rolled-back install is not runnable.
  }
  try {
    accessSync(binPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function isTransientInstallError(err) {
  const text = err instanceof Error ? err.message : String(err ?? "");
  return /EAI_AGAIN|EAI_NONAME|EAI_FAIL|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|getaddrinfo|timeout fetching|socket hang up/i.test(text);
}

export function briefInstallError(err) {
  const lines = (err instanceof Error ? err.message : String(err ?? ""))
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  const line = lines.find((item) => /EAI_|getaddrinfo|ENOTFOUND|ETIMEDOUT|ECONN/.test(item))
    ?? lines.find((item) => /failed to download|timed out|EACCES|Permission denied/.test(item));
  const picked = (line ?? lines[0] ?? "install failed").replace(/^npm error\s+/, "");
  return picked.slice(0, 240);
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry only blips such as DNS EAI_AGAIN. A permanent failure still throws. */
export async function attemptInstall(runOnce, options = {}) {
  const attempts = options.attempts ?? INSTALL_ATTEMPTS;
  const wait = options.pause ?? pause;
  const pauseMs = options.pauseMs ?? INSTALL_PAUSE_MS;
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runOnce();
    } catch (err) {
      last = err;
      if (attempt === attempts || !isTransientInstallError(err)) throw err;
      await wait(pauseMs);
    }
  }
  throw last;
}

function cliUnusable(err) {
  const text = err instanceof Error ? err.message : String(err ?? "");
  return /EACCES|EPERM|ENOENT|Permission denied|vendor binary not found/.test(text);
}

export function packInstallArgs(pack) {
  const spec = `${pack.cli.package}@${pack.cli.version}`;
  return ["install", "--global", "--omit=dev", "--prefix", homePrefix(), spec];
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        PATH: `${join(homePrefix(), "bin")}${process.env.PATH ? `:${process.env.PATH}` : ""}`,
      },
      stdio: [options.stdin == null ? "ignore" : "pipe", "pipe", "pipe"],
      timeout: options.timeoutMs ?? 120_000,
    });
    if (options.stdin != null) child.stdin.end(String(options.stdin));
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (code === 0) {
        resolve(out);
        return;
      }
      reject(new Error(err.trim() || out.trim() || `${command} exited ${code}`));
    });
  });
}

async function installPackCli(pack) {
  const spec = `${pack.cli.package}@${pack.cli.version}`;
  try {
    // `--global` is required with a custom prefix: without it npm creates
    // node_modules/.bin, while the persistent user CLI contract is <prefix>/bin.
    await attemptInstall(() => run("npm", packInstallArgs(pack), { timeoutMs: 600_000 }));
  } catch (err) {
    throw new HttpError("cli_install_failed", 502, `failed to install ${spec}: ${briefInstallError(err)}`);
  }
}

export async function ensurePackCli(pack) {
  if (!pack?.cli) return true;
  const bin = cliBinPath(pack);
  if (repairCliBin(bin)) return true;
  await installPackCli(pack);
  if (!repairCliBin(bin)) {
    throw new HttpError("cli_install_failed", 502, `${pack.cli.bin} was not executable after install`);
  }
  return true;
}

async function exportPackSkills(pack, dataDir) {
  const bin = cliBinPath(pack);
  let listing;
  try {
    listing = await run(bin, pack.cli.listArgs, { timeoutMs: 60_000 });
  } catch (err) {
    throw new HttpError(
      "skill_export_failed",
      502,
      err instanceof Error ? err.message : "failed to list bundled skills",
    );
  }
  const names = parseSkillNames(listing).filter((name) => name.startsWith(pack.prefix));
  if (names.length === 0) {
    throw new HttpError("skill_export_failed", 502, `${pack.cli.bin} reported no ${pack.prefix} skills`);
  }
  const files = [];
  for (const name of names) {
    try {
      const body = await run(bin, pack.cli.showArgs(name), { timeoutMs: 30_000 });
      files.push({ name, body });
    } catch (err) {
      throw new HttpError(
        "skill_export_failed",
        502,
        err instanceof Error ? err.message : `failed to export ${name}`,
      );
    }
  }
  writeExportedSkills(packCacheDir(dataDir, pack.id), files);
  return files.length;
}

export async function downloadPackSkills(pack, dataDir) {
  await ensurePackCli(pack);
  try {
    return await exportPackSkills(pack, dataDir);
  } catch (err) {
    if (!cliUnusable(err)) throw err;
    await installPackCli(pack);
    if (!repairCliBin(cliBinPath(pack))) {
      throw new HttpError("cli_install_failed", 502, `${pack.cli.bin} was not executable after install`);
    }
    return await exportPackSkills(pack, dataDir);
  }
}

const emptyConnection = { configured: false, server: "" };

export async function readCliConnection(pack) {
  if (!pack?.cli) return emptyConnection;
  const bin = cliBinPath(pack);
  if (!repairCliBin(bin)) return emptyConnection;
  try {
    const out = await run(bin, ["profile", "show", HASS_PROFILE, "-o", "json"], { timeoutMs: 15_000 });
    return connectionStatus(out);
  } catch (err) {
    return connectionStatus(err instanceof Error ? err.message : "");
  }
}

export async function saveCliConnection(pack, input) {
  await ensurePackCli(pack);
  const bin = cliBinPath(pack);
  try {
    await run(bin, profileLoginArgs(input.server), { timeoutMs: 30_000, stdin: input.token });
  } catch (err) {
    throw new HttpError("connection_failed", 502, scrubSecret(briefInstallError(err), input.token));
  }
  return readCliConnection(pack);
}

export function cliReadyMap(packs) {
  /** @type {Record<string, boolean>} */
  const ready = {};
  for (const pack of packs) ready[pack.id] = cliPresent(pack);
  return ready;
}
