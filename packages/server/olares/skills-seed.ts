import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BUNDLED = path.join(PACKAGE_ROOT, "skills");

/** Copy vendored olares-* skills into the runtime skills dir for dsh skill-filesystem. */
export function seedOlaresSkills(targetDir: string): string {
  mkdirSync(targetDir, { recursive: true });
  if (!existsSync(BUNDLED)) return targetDir;

  for (const name of readdirSync(BUNDLED)) {
    const from = path.join(BUNDLED, name);
    if (!statSync(from).isDirectory()) continue;
    const to = path.join(targetDir, name);
    rmSync(to, { recursive: true, force: true });
    cpSync(from, to, { recursive: true });
  }
  return targetDir;
}

export function bundledSkillsRoot(): string {
  return BUNDLED;
}
