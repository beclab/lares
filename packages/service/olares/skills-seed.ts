import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncRuntimeSkills } from "@olares/lares-core/skills/state";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function bundledSkillsRoot() {
  return process.env.LARES_SKILLS_ROOT?.trim() || path.join(APP_ROOT, "packages", "skills");
}

/** Seed always-on image skills, plus optional packs that the user has enabled. */
export function seedOlaresSkills(targetDir: string): string {
  return syncRuntimeSkills(bundledSkillsRoot(), path.dirname(targetDir));
}

export function seedSkillsForDataDir(dataDir: string): string {
  return seedOlaresSkills(path.join(dataDir, "skills"));
}
