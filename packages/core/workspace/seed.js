import { mkdirSync } from "node:fs";
import { DEFAULT_WORKSPACE_TITLE } from "./constants.js";

export { DEFAULT_WORKSPACE_TITLE };

/**
 * @param {{ create: (path: string, title?: string) => Promise<{ id: string, path: string, title: string }> }} registry
 * @param {string} workspacePath
 * @param {string} [title]
 */
export async function seedDefaultWorkspace(registry, workspacePath, title = DEFAULT_WORKSPACE_TITLE) {
  mkdirSync(workspacePath, { recursive: true });
  return registry.create(workspacePath, title);
}
