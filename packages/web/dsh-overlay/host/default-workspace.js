import { workspaceRootFromEnv } from "@lares/core/workspace/env";
import { DEFAULT_WORKSPACE_TITLE, seedDefaultWorkspace } from "@lares/core/workspace/seed";

export { DEFAULT_WORKSPACE_TITLE, seedDefaultWorkspace, workspaceRootFromEnv };

export const name = "lares-default-workspace";
export const inject = ["workspaceRegistry"];

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
