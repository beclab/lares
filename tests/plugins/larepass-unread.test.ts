import assert from "node:assert/strict";
import test from "node:test";
import { consumeMux } from "@olares/lares-core/larepass/mux";
import { createChatRuntime } from "@olares/lares-core/larepass/runtime";
import { markSeen, pruneSeen, readSeen, unseenSessions } from "@olares/lares-core/larepass/unread";

test("readSeen pins a floor and keeps only usable stamps", () => {
  const fresh = readSeen(null, 500);
  assert.deepEqual(fresh, { since: 500, sessions: {} });

  const stored = readSeen({ since: 100, sessions: { a: 7, b: "x", "": 9, c: -1 } }, 500);
  assert.deepEqual(stored, { since: 100, sessions: { a: 7 } });
});

test("a session is unseen once it moves on without being watched", () => {
  const seen = readSeen({ since: 100, sessions: { watched: 300 } }, 100);
  const sessions = [
    { sessionId: "watched", updatedAt: 400, blank: false },
    { sessionId: "quiet", updatedAt: 50, blank: false },
    { sessionId: "arrived", updatedAt: 400, blank: false },
    { sessionId: "open", updatedAt: 400, blank: false },
    { sessionId: "blank", updatedAt: 400, blank: true },
  ];

  assert.deepEqual(unseenSessions(sessions, seen, "open"), { watched: true, arrived: true });
  // Opening it is what clears the dot, and the stamp only ever moves forward.
  const after = markSeen(seen, "watched", 500);
  assert.deepEqual(unseenSessions(sessions, after, "open"), { arrived: true });
  assert.equal(markSeen(after, "watched", 200), after);
  assert.equal(markSeen(after, "", 900), after);
});

test("pruneSeen forgets sessions the host stopped listing", () => {
  const seen = readSeen({ since: 1, sessions: { a: 2, b: 3 } });
  assert.deepEqual(pruneSeen(seen, [{ sessionId: "a" }]), { since: 1, sessions: { a: 2 } });
  assert.equal(pruneSeen(seen, [{ sessionId: "a" }, { sessionId: "b" }]), seen);
});

function backgroundClient() {
  let controller;
  let encoder;
  const body = new ReadableStream({
    start(c) {
      controller = c;
      encoder = new TextEncoder();
    },
  });
  return {
    push(payload) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: "server-request",
        rpcId: "r1",
        method: payload.type,
        payload,
      })}\n\n`));
    },
    close: () => controller.close(),
    probe: async () => ({ status: "ok", http: 200 }),
    ensureSession: async () => ({ ok: true, value: { sessionId: "open" } }),
    rpc: async (method) => {
      if (method === "session.list") {
        return {
          ok: true,
          value: {
            items: [
              { sessionId: "open", title: "open", updatedAt: 10 },
              { sessionId: "away", title: "away", updatedAt: 10 },
            ],
          },
        };
      }
      if (method === "session.history") return { ok: true, value: { events: [] } };
      throw new Error(method);
    },
    prompt: async () => ({ ok: true, value: { accepted: true } }),
    openMux: async () => ({ ok: true, http: 200, body }),
    consumeMux,
  };
}

test("mux traffic dates a session that is not on screen, so it can read as unseen", async () => {
  const client = backgroundClient();
  const runtime = createChatRuntime(client);
  await runtime.start();

  const before = runtime.snapshot().sessions.find((row) => row.sessionId === "away");
  assert.equal(before.updatedAt, 10);

  client.push({
    type: "session/event",
    sessionId: "away",
    event: { type: "assistant/message", seq: 1, data: { content: [{ type: "text", text: "done" }] } },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const snap = runtime.snapshot();
  const away = snap.sessions.find((row) => row.sessionId === "away");
  assert.ok(away.updatedAt > 10, "a background session is dated by its own events");
  assert.deepEqual(
    unseenSessions(snap.sessions, readSeen({ since: 20, sessions: {} }), snap.sessionId),
    { away: true },
  );

  runtime.dispose();
  client.close();
});
