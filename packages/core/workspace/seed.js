import { mkdirSync } from "node:fs";

export const DEFAULT_WORKSPACE_TITLE = "Default";

/**
 * @param {{ create: (path: string, title?: string) => Promise<{ id: string, path: string, title: string }> }} registry
 * @param {string} workspacePath
 * @param {string} [title]
 */
export async function seedDefaultWorkspace(registry, workspacePath, title = DEFAULT_WORKSPACE_TITLE) {
  mkdirSync(workspacePath, { recursive: true });
  return registry.create(workspacePath, title);
}
