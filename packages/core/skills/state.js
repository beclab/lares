import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HttpError } from "../tools/http.js";
import { readJsonFile, writeJsonFile } from "../tools/json-file.js";
import { ALWAYS_ON_PREFIXES, OFFICIAL_PACKS, packById, packForSkillDir } from "./packs.js";

export function packsStatePath(dataDir) {
  return join(dataDir, "skill-packs.json");
}

export function runtimeSkillsDir(dataDir) {
  return join(dataDir, "skills");
}

export function packCacheDir(dataDir, packId) {
  return join(dataDir, "skill-packs", packId);
}

export function defaultCatalogRoot() {
  return process.env.LARES_SKILLS_ROOT?.trim() || join(process.cwd(), "packages", "skills");
}

function directoryNames(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((name) => {
    try {
      return statSync(join(root, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

export function readEnabledPacks(dataDir) {
  const raw = readJsonFile(packsStatePath(dataDir));
  const listed = Array.isArray(raw?.enabled) ? raw.enabled : [];
  return listed.filter((id) => typeof id === "string" && packById(id));
}

export function writeEnabledPacks(dataDir, enabled) {
  writeJsonFile(packsStatePath(dataDir), { enabled: [...new Set(enabled)] });
}

export function cachedSkillDirs(dataDir, pack) {
  return directoryNames(packCacheDir(dataDir, pack.id)).filter((name) => name.startsWith(pack.prefix));
}

export function packDownloaded(dataDir, pack) {
  return cachedSkillDirs(dataDir, pack).length > 0;
}

function shouldKeepRuntimeDir(name, enabledIds) {
  if (ALWAYS_ON_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
  const pack = packForSkillDir(name);
  if (!pack) return false;
  return enabledIds.includes(pack.id);
}

/**
 * Image catalog supplies always-on skills (olares-* / lares-*).
 * Optional packs are copied from their download cache only when enabled.
 */
export function syncRuntimeSkills(catalogRoot, dataDir) {
  const targetDir = runtimeSkillsDir(dataDir);
  mkdirSync(targetDir, { recursive: true });
  const enabled = readEnabledPacks(dataDir);

  for (const name of directoryNames(targetDir)) {
    if (shouldKeepRuntimeDir(name, enabled)) continue;
    rmSync(join(targetDir, name), { recursive: true, force: true });
  }

  for (const name of directoryNames(catalogRoot)) {
    if (!ALWAYS_ON_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    const to = join(targetDir, name);
    rmSync(to, { recursive: true, force: true });
    cpSync(join(catalogRoot, name), to, { recursive: true });
  }

  for (const pack of OFFICIAL_PACKS) {
    if (!enabled.includes(pack.id)) continue;
    for (const name of cachedSkillDirs(dataDir, pack)) {
      const to = join(targetDir, name);
      rmSync(to, { recursive: true, force: true });
      cpSync(join(packCacheDir(dataDir, pack.id), name), to, { recursive: true });
    }
  }
  return targetDir;
}

export function writeExportedSkills(cacheDir, files) {
  mkdirSync(cacheDir, { recursive: true });
  for (const name of directoryNames(cacheDir)) {
    rmSync(join(cacheDir, name), { recursive: true, force: true });
  }
  for (const file of files) {
    if (!file?.name || typeof file.body !== "string") continue;
    const dir = join(cacheDir, file.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), file.body);
  }
}

export function listOfficialPacks(dataDir, cliReady = {}) {
  const enabled = readEnabledPacks(dataDir);
  return OFFICIAL_PACKS.map((pack) => {
    const cached = cachedSkillDirs(dataDir, pack);
    const downloaded = cached.length > 0;
    const on = enabled.includes(pack.id);
    return {
      id: pack.id,
      official: true,
      optional: true,
      downloaded,
      enabled: on,
      skillCount: downloaded ? cached.length : 0,
      cliBin: pack.cli?.bin ?? null,
      cliReady: Boolean(cliReady[pack.id]),
    };
  });
}

export function enableOfficialPack(catalogRoot, dataDir, id) {
  const pack = packById(id);
  if (!pack) throw new HttpError("unknown_pack", 404, `unknown skill pack ${id}`);
  if (!packDownloaded(dataDir, pack)) {
    throw new HttpError("pack_not_downloaded", 409, `skill pack ${id} is not downloaded`);
  }
  writeEnabledPacks(dataDir, [...readEnabledPacks(dataDir), pack.id]);
  syncRuntimeSkills(catalogRoot, dataDir);
  return pack;
}

export function disableOfficialPack(catalogRoot, dataDir, id) {
  const pack = packById(id);
  if (!pack) throw new HttpError("unknown_pack", 404, `unknown skill pack ${id}`);
  writeEnabledPacks(dataDir, readEnabledPacks(dataDir).filter((item) => item !== pack.id));
  syncRuntimeSkills(catalogRoot, dataDir);
  return pack;
}

export { packForSkillDir };
