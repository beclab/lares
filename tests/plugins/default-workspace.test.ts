import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceRootFromEnv, workspaceRootFromSession } from "@lares/core/workspace/env";
import { DEFAULT_WORKSPACE_TITLE, seedDefaultWorkspace } from "@lares/core/workspace/seed";

test("workspaceRootFromEnv prefers DSH_CWD then LARES_WORKSPACE", () => {
  assert.equal(workspaceRootFromEnv({}), null);
  assert.equal(workspaceRootFromEnv({ LARES_WORKSPACE: "  " }), null);
  assert.equal(workspaceRootFromEnv({ LARES_WORKSPACE: "/data/workspace" }), "/data/workspace");
  assert.equal(
    workspaceRootFromEnv({ DSH_CWD: "/app/work", LARES_WORKSPACE: "/data/workspace" }),
    "/app/work",
  );
});

test("workspaceRootFromSession prefers the live session cwd", () => {
  assert.equal(
    workspaceRootFromSession({ agent: { session: { header: { cwd: "/session/work" } } } }),
    "/session/work",
  );
  assert.throws(() => workspaceRootFromSession({}, {}), { message: /no session workspace/ });
});

test("seedDefaultWorkspace creates the directory and registers it once", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-ws-"));
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
