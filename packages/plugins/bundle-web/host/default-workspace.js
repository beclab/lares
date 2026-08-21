/**
 * Register the deployment cwd as a Host workspace so New Session lands there
 * when the user has not created one (dsh otherwise leaves those sessions Ungrouped).
 */
import { mkdirSync } from "node:fs";

export const name = "lares-default-workspace";
export const inject = ["workspaceRegistry"];

export const DEFAULT_WORKSPACE_TITLE = "Default";

/** @param {NodeJS.ProcessEnv} [env] */
export function workspaceRootFromEnv(env = process.env) {
  const value = env.DSH_CWD ?? env.LARES_WORKSPACE;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * @param {{ create: (path: string, title?: string) => Promise<{ id: string, path: string, title: string }> }} registry
 * @param {string} workspacePath
 * @param {string} [title]
 */
export async function seedDefaultWorkspace(registry, workspacePath, title = DEFAULT_WORKSPACE_TITLE) {
  mkdirSync(workspacePath, { recursive: true });
  return registry.create(workspacePath, title);
}

/**
 * @param {import("@deepseek-ai/cordis").Context} ctx
 */
export async function apply(ctx) {
  const root = workspaceRootFromEnv();
  if (root === null) {
    console.warn("[lares] default workspace skipped: DSH_CWD / LARES_WORKSPACE unset");
    return;
  }
  try {
    const workspace = await seedDefaultWorkspace(ctx.workspaceRegistry, root);
    console.log(`[lares] default workspace id=${workspace.id} path=${workspace.path} title=${workspace.title}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[lares] default workspace seed failed: ${message}`);
  }
}
