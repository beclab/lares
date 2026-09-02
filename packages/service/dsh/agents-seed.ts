import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  agentsMarkdown,
  LEGACY_AGENTS_SEEDS,
} from "@olares/lares-core/brand/identity";

/** Ensure the workspace has an AGENTS.md so dsh workspaceContext has a baseline. */
export function seedWorkspaceAgents(workspace: string): void {
  mkdirSync(workspace, { recursive: true });
  const target = path.join(workspace, "AGENTS.md");
  const next = agentsMarkdown();
  let previous: string | null = null;
  try {
    previous = readFileSync(target, "utf8");
  } catch {
    previous = null;
  }
  if (previous === next) return;
  if (previous !== null && !LEGACY_AGENTS_SEEDS.includes(previous)) return;
  writeFileSync(target, next, "utf8");
}
