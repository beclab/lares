import assert from "node:assert/strict";
import test from "node:test";
import {
  COLLAPSED_SESSION_LIMIT,
  FLAT_SESSION_ORDER_KEY,
  collapsedSessions,
  groupWorkspaceSessions,
  hiddenSessionCount,
  nextSessionOrderAccount,
  normalizeWorkspaceList,
  reconciledSessionOrder,
  workspaceForSession,
} from "@olares/lares-core/larepass/workspace";
import { createChatRuntime } from "@olares/lares-core/larepass/runtime";
import {
  dropAnchor,
  insertSessionBefore,
  loadWorkspaceView,
  saveWorkspaceView,
  syncWorkspaceViewOrders,
} from "../../packages/mobile/src/desktop/workspace-view.js";

test("workspace groups follow the host account and keep ungrouped sessions", () => {
  const sessions = [
    { sessionId: "s1", title: "Alpha", updatedAt: 10, blank: false },
    { sessionId: "s2", title: "Beta", updatedAt: 20, blank: false },
    { sessionId: "s3", title: "Archived", updatedAt: 30, blank: false },
  ];
  const workspaces = [
    { workspaceId: "w1", title: "Default", path: "/data/workspace", sessionIds: ["s1", "s3"] },
  ];
  assert.equal(workspaceForSession(workspaces, "s1")?.workspaceId, "w1");
  assert.deepEqual(
    groupWorkspaceSessions(sessions, workspaces, ["s3"]).map((group) => ({
      key: group.key,
      path: group.path,
      sessions: group.sessions.map((row) => row.sessionId),
    })),
    [
      { key: "w1", path: "/data/workspace", sessions: ["s1"] },
      { key: "", path: undefined, sessions: ["s2"] },
    ],
  );
});

test("workspace grouping supports title search, flat view, and recency", () => {
  const sessions = [
    { sessionId: "old", title: "Build report", updatedAt: 1, blank: false },
    { sessionId: "new", title: "Build desktop", updatedAt: 9, blank: false },
    { sessionId: "other", title: "Weather", updatedAt: 20, blank: false },
  ];
  const groups = groupWorkspaceSessions(sessions, [], [], {
    query: "build",
    orderBy: "updated",
    flat: true,
  });
  assert.deepEqual(groups[0].sessions.map((row) => row.sessionId), ["new", "old"]);
});

test("updated order promotes changed sessions without reshuffling untouched rows", () => {
  const sessions = [
    { sessionId: "a", updatedAt: 10 },
    { sessionId: "b", updatedAt: 30 },
    { sessionId: "c", updatedAt: 20 },
  ];
  const initial = nextSessionOrderAccount({
    sessionIds: ["a", "b", "c"],
    sessions,
    orderBy: "updated",
    sortByRecency: true,
  });
  assert.deepEqual(initial.order, ["b", "c", "a"]);

  const promoted = nextSessionOrderAccount({
    sessionIds: ["a", "b", "c"],
    previousOrder: initial.order,
    previousUpdatedAt: initial.updatedAt,
    sessions: sessions.map((row) => row.sessionId === "a" ? { ...row, updatedAt: 40 } : row),
    orderBy: "updated",
  });
  assert.deepEqual(promoted.order, ["a", "b", "c"]);

  assert.deepEqual(
    reconciledSessionOrder(["b", "c", "d"], ["c", "missing", "b"]),
    ["c", "b", "d"],
  );
});

test("workspace view ordering matches Lares accounts and promotes the selected blank", () => {
  const view = loadWorkspaceView(null);
  const sessions = [
    { sessionId: "old", updatedAt: 1, blank: false },
    { sessionId: "new", updatedAt: 3, blank: false },
    { sessionId: "draft", updatedAt: 0, blank: true },
    { sessionId: "loose", updatedAt: 2, blank: false },
  ];
  const synced = syncWorkspaceViewOrders(view, {
    sessions,
    workspaces: [{ workspaceId: "w1", sessionIds: ["old", "new", "draft"] }],
    currentSessionId: "draft",
  });
  assert.deepEqual(synced.sessionOrderByAccount.w1, ["draft", "new", "old"]);
  assert.deepEqual(synced.sessionOrderByAccount[""], ["loose"]);
  assert.deepEqual(
    synced.sessionOrderByAccount[FLAT_SESSION_ORDER_KEY],
    ["draft", "new", "loose", "old"],
  );
  assert.deepEqual(insertSessionBefore(["a", "b", "c"], "c", "a"), ["c", "a", "b"]);
});

test("the drop marker's edge is the row the move inserts before", () => {
  const ids = ["a", "b", "c"];

  assert.equal(dropAnchor(ids, { key: "b", edge: "before" }), "b");
  assert.equal(dropAnchor(ids, { key: "b", edge: "after" }), "c");
  // Past the last row there is nothing to insert before, so the move appends.
  assert.equal(dropAnchor(ids, { key: "c", edge: "after" }), "");
  assert.equal(dropAnchor(ids, { key: "gone", edge: "before" }), "");
  assert.equal(dropAnchor(ids, null), "");

  assert.deepEqual(
    insertSessionBefore(ids, "a", dropAnchor(ids, { key: "c", edge: "after" })),
    ["b", "c", "a"],
  );
  assert.deepEqual(
    insertSessionBefore(ids, "c", dropAnchor(ids, { key: "a", edge: "after" })),
    ["a", "c", "b"],
  );
});

test("workspace view state persists independently from Host accounts", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
  };
  const view = {
    ...loadWorkspaceView(null),
    groupBy: "flat",
    orderBy: "manual",
    groupExpansion: { w1: false },
  };
  saveWorkspaceView(view, storage);
  assert.deepEqual(loadWorkspaceView(storage), view);
});

test("blank sessions stay hidden unless selected, and never fall through to ungrouped", () => {
  const sessions = [
    { sessionId: "s1", title: "Alpha", updatedAt: 10, blank: false },
    { sessionId: "spare", title: "", updatedAt: 30, blank: true },
    { sessionId: "current", title: "", updatedAt: 20, blank: true },
    { sessionId: "member-blank", title: "", updatedAt: 40, blank: true },
  ];
  const workspaces = [
    { workspaceId: "w1", title: "Default", sessionIds: ["s1", "member-blank"] },
  ];
  assert.deepEqual(
    groupWorkspaceSessions(sessions, workspaces, [], { currentSessionId: "current" }).map((group) => ({
      key: group.key,
      sessions: group.sessions.map((row) => row.sessionId),
    })),
    [
      { key: "w1", sessions: ["s1"] },
      { key: "", sessions: ["current"] },
    ],
  );
});

test("a folded group cuts to five rows and reports the remainder", () => {
  const sessions = Array.from({ length: 8 }, (_, i) => ({ sessionId: `s${i}`, title: `S${i}` }));
  assert.equal(COLLAPSED_SESSION_LIMIT, 5);
  assert.deepEqual(
    collapsedSessions(sessions, false).map((row) => row.sessionId),
    ["s0", "s1", "s2", "s3", "s4"],
  );
  assert.equal(collapsedSessions(sessions, true).length, 8);
  assert.equal(hiddenSessionCount(sessions), 3);
  assert.equal(hiddenSessionCount(sessions.slice(0, 5)), 0);
});

test("workspace list normalization rejects malformed rows", () => {
  assert.deepEqual(normalizeWorkspaceList({
    items: [null, { title: "missing" }, { workspaceId: "w1", sessionIds: [] }],
    archivedSessionIds: ["s1"],
  }), {
    items: [{ workspaceId: "w1", sessionIds: [] }],
    archivedSessionIds: ["s1"],
  });
});

test("runtime creates a session in the selected host workspace", async () => {
  const calls = [];
  let controller;
  const body = new ReadableStream({ start(value) { controller = value; } });
  const client = {
    probe: async () => ({ status: "ok" }),
    ensureSession: async () => ({
      ok: true,
      value: {
        sessionId: "s1",
        sessions: [{ sessionId: "s1", title: "Existing", blank: false }],
      },
    }),
    rpc: async (method, payload) => {
      calls.push({ method, payload });
      if (method === "session.history") {
        return {
          ok: true,
          value: {
            events: [{
              type: "user/message",
              seq: 1,
              data: { content: [{ type: "text", text: "hi" }], source: { kind: "user" } },
            }],
          },
        };
      }
      if (method === "workspace.list") {
        return {
          ok: true,
          value: {
            items: [{ workspaceId: "w1", title: "Default", path: "/data/workspace", sessionIds: ["s1"] }],
            archivedSessionIds: [],
          },
        };
      }
      if (method === "session.create") return { ok: true, value: { sessionId: "s2" } };
      throw new Error(method);
    },
    openMux: async () => ({ ok: true, body }),
    prompt: async () => ({ ok: true }),
  };
  const runtime = createChatRuntime(client);
  await runtime.start();
  await runtime.refreshWorkspaces();
  await runtime.createSession("w1");
  assert.deepEqual(
    calls.find((call) => call.method === "session.create"),
    { method: "session.create", payload: { workspaceId: "w1" } },
  );
  assert.equal(runtime.snapshot().sessionId, "s2");
  assert.deepEqual(runtime.snapshot().workspaces[0].sessionIds, ["s2", "s1"]);
  runtime.dispose();
  controller.close();
});

test("runtime forwards official workspace and directory mutations", async () => {
  const calls = [];
  const workspace = {
    workspaceId: "w1",
    title: "Renamed",
    path: "/data/workspace",
    sessionIds: ["s1"],
  };
  const client = {
    rpc: async (method, payload) => {
      calls.push({ method, payload });
      if (method === "workspace.list") {
        return { ok: true, value: { items: [workspace], archivedSessionIds: [] } };
      }
      if (method === "workspace.rename") return { ok: true, value: { workspace } };
      if (method === "workspace.delete") return { ok: true, value: { deleted: true } };
      if (method === "workspace.insertBefore") return { ok: true, value: { workspaceIds: ["w1"] } };
      if (method === "workspace.insertSessionBefore") return { ok: true, value: { workspace } };
      if (method === "workspace.archiveSession") return { ok: true, value: { archivedSessionIds: ["s1"] } };
      if (method === "host.listDirectory") {
        return { ok: true, value: { path: "/data", home: "/root", crumbs: [], entries: [] } };
      }
      if (method === "host.createDirectory") {
        return { ok: true, value: { path: `${payload.path}/${payload.name}` } };
      }
      throw new Error(method);
    },
  };
  const runtime = createChatRuntime(client);
  await runtime.refreshWorkspaces();
  await runtime.renameWorkspace("w1", "Renamed");
  await runtime.insertWorkspaceBefore("w1");
  await runtime.insertSessionBefore("w1", "s1");
  await runtime.archiveSession("s1");
  await runtime.listDirectory("/data");
  await runtime.createDirectory("/data", "new-folder");
  await runtime.deleteWorkspace("w1");
  assert.deepEqual(calls.map(({ method, payload }) => [method, payload]), [
    ["workspace.list", {}],
    ["workspace.rename", { workspaceId: "w1", title: "Renamed" }],
    ["workspace.insertBefore", { workspaceId: "w1" }],
    ["workspace.insertSessionBefore", { workspaceId: "w1", sessionId: "s1" }],
    ["workspace.archiveSession", { sessionId: "s1" }],
    ["host.listDirectory", { path: "/data" }],
    ["host.createDirectory", { path: "/data", name: "new-folder" }],
    ["workspace.delete", { workspaceId: "w1" }],
  ]);
  assert.deepEqual(runtime.snapshot().archivedSessionIds, ["s1"]);
  assert.deepEqual(runtime.snapshot().workspaces, []);
  runtime.dispose();
});

test("forking opens the host's child session and re-reads the tracked lists", async () => {
  const calls: string[] = [];
  let controller: ReadableStreamDefaultController;
  const body = new ReadableStream({ start(value) { controller = value; } });
  const sessions = [{ sessionId: "s1", title: "Source", updatedAt: 5 }];
  const client = {
    probe: async () => ({ status: "ok" }),
    ensureSession: async () => ({ ok: true, value: { sessionId: "s1", sessions } }),
    rpc: async (method: string) => {
      calls.push(method);
      if (method === "session.fork") return { ok: true, value: { sessionId: "s2" } };
      if (method === "session.list") {
        return {
          ok: true,
          value: {
            items: [
              ...sessions,
              { sessionId: "s2", title: "Source (fork)", updatedAt: 6, parentSessionId: "s1" },
              { sessionId: "tool", title: "tool", parentSessionId: "s1", origin: "subagent" },
            ],
          },
        };
      }
      if (method === "workspace.list") {
        return {
          ok: true,
          value: {
            items: [{ workspaceId: "w1", title: "Default", sessionIds: ["s2", "s1"] }],
            archivedSessionIds: [],
          },
        };
      }
      if (method === "session.history") return { ok: true, value: { events: [] } };
      throw new Error(method);
    },
    openMux: async () => ({ ok: true, body }),
    prompt: async () => ({ ok: true }),
  };
  const runtime = createChatRuntime(client);
  await runtime.start();
  await runtime.refreshWorkspaces();
  const forked = await runtime.forkSession("s1");

  assert.equal(forked.ok, true);
  assert.ok(calls.includes("session.fork"));
  assert.equal(runtime.snapshot().sessionId, "s2");
  // The child rides parentSessionId; only subagent runs stay off the list.
  assert.deepEqual(
    runtime.snapshot().sessions.map((row: { sessionId: string }) => row.sessionId),
    ["s1", "s2"],
  );
  runtime.dispose();
  controller!.close();
});

test("a failed fork surfaces on the runtime's failure channel", async () => {
  const runtime = createChatRuntime({
    rpc: async () => ({ ok: false, error: { code: "busy", message: "session busy" } }),
  });
  const failed = await runtime.forkSession("s1");
  assert.equal(failed.ok, false);
  assert.equal(runtime.snapshot().failed, "session busy");
  assert.equal((await runtime.forkSession("")).error.code, "no_session");
  runtime.dispose();
});

test("desktop startup creates its first blank session inside the default workspace", async () => {
  let createPayload;
  let controller;
  const body = new ReadableStream({ start(value) { controller = value; } });
  const client = {
    probe: async () => ({ status: "ok" }),
    ensureSession: async () => {
      throw new Error("desktop workspace startup must not create an ungrouped session");
    },
    rpc: async (method, payload) => {
      if (method === "session.list") return { ok: true, value: { items: [] } };
      if (method === "workspace.list") {
        return {
          ok: true,
          value: {
            items: [{ workspaceId: "default", title: "Default", path: "/data/workspace", sessionIds: [] }],
            archivedSessionIds: [],
          },
        };
      }
      if (method === "session.create") {
        createPayload = payload;
        return { ok: true, value: { sessionId: "s1" } };
      }
      throw new Error(method);
    },
    openMux: async () => ({ ok: true, body }),
    prompt: async () => ({ ok: true }),
  };
  const runtime = createChatRuntime(client);
  await runtime.start({ workspaces: true });
  assert.deepEqual(createPayload, { workspaceId: "default" });
  assert.equal(runtime.snapshot().sessionId, "s1");
  runtime.dispose();
  controller.close();
});
