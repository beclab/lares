import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { HttpError } from "@olares/lares-core/tools/http";
import { parseSkillNames } from "@olares/lares-core/skills/packs";
import { packCacheDir, writeExportedSkills } from "@olares/lares-core/skills/state";

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
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeoutMs ?? 120_000,
    });
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

export async function ensurePackCli(pack) {
  if (!pack?.cli) return true;
  if (cliPresent(pack)) return true;
  const spec = `${pack.cli.package}@${pack.cli.version}`;
  try {
    // `--global` is required with a custom prefix: without it npm creates
    // node_modules/.bin, while the persistent user CLI contract is <prefix>/bin.
    await run("npm", packInstallArgs(pack), { timeoutMs: 600_000 });
  } catch (err) {
    throw new HttpError(
      "cli_install_failed",
      502,
      err instanceof Error ? err.message : `failed to install ${spec}`,
    );
  }
  if (!cliPresent(pack)) {
    throw new HttpError("cli_install_failed", 502, `${pack.cli.bin} was not on PATH after install`);
  }
  return true;
}

export async function downloadPackSkills(pack, dataDir) {
  await ensurePackCli(pack);
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

export function cliReadyMap(packs) {
  /** @type {Record<string, boolean>} */
  const ready = {};
  for (const pack of packs) ready[pack.id] = cliPresent(pack);
  return ready;
}
