import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const pluginPath = resolve(HERE, "../../packages/plugins/bundle-web/host/default-workspace.js");

const { DEFAULT_WORKSPACE_TITLE, seedDefaultWorkspace, workspaceRootFromEnv } = await import(pluginPath);

test("workspaceRootFromEnv prefers DSH_CWD then DINA_WORKSPACE", () => {
  assert.equal(workspaceRootFromEnv({}), null);
  assert.equal(workspaceRootFromEnv({ DINA_WORKSPACE: "  " }), null);
  assert.equal(workspaceRootFromEnv({ DINA_WORKSPACE: "/data/workspace" }), "/data/workspace");
  assert.equal(
    workspaceRootFromEnv({ DSH_CWD: "/app/work", DINA_WORKSPACE: "/data/workspace" }),
    "/app/work",
  );
});

test("seedDefaultWorkspace creates the directory and registers it once", async () => {
  const root = mkdtempSync(join(tmpdir(), "dina-ws-"));
  const workspacePath = join(root, "nested", "work");
  const calls: { path: string; title?: string }[] = [];
  const created = { id: "ws-1", path: workspacePath, title: DEFAULT_WORKSPACE_TITLE };
  const registry = {
    create: async (path: string, title?: string) => {
      calls.push({ path, title });
      return created;
    },
  };

  try {
    const first = await seedDefaultWorkspace(registry, workspacePath);
    assert.equal(first, created);
    assert.deepEqual(calls, [{ path: workspacePath, title: DEFAULT_WORKSPACE_TITLE }]);

    const existing = { id: "ws-1", path: workspacePath, title: "项目" };
    registry.create = async (path: string, title?: string) => {
      calls.push({ path, title });
      return existing;
    };
    const second = await seedDefaultWorkspace(registry, workspacePath);
    assert.equal(second.title, "项目");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
