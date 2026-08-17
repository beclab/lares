import { accessSync, constants, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_AGENTS = `# AGENTS.md

You are helping inside an Olares workspace via Dina (DeepSeek Harness).

- Prefer olares-cli skills for platform tasks (market, cluster, files, router, …).
- Stay inside the workspace for file edits unless the user explicitly asks otherwise.
- Prefer structured fs tools (read / write / edit) over shell for file work.
- Long-running shell work can use background jobs; check results with job_output.
- \`@path\` in a user message is workspace-relative, not absolute; \`/id\` names a skill.
`;

/** Ensure the workspace has an AGENTS.md so dsh workspaceContext has a baseline. */
export function seedWorkspaceAgents(workspace: string): void {
  mkdirSync(workspace, { recursive: true });
  const target = path.join(workspace, "AGENTS.md");
  try {
    accessSync(target, constants.F_OK);
  } catch {
    writeFileSync(target, DEFAULT_AGENTS, "utf8");
  }
}
