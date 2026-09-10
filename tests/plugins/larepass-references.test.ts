import assert from "node:assert/strict";
import test from "node:test";
import {
  activeReferenceToken,
  formatFileMention,
  insertReference,
  normalizeReferenceCandidates,
  referencesUrl,
  sessionReferenceCandidates,
} from "@olares/lares-core/larepass/references";

test("reference tokens follow the official plain and quoted grammar", () => {
  assert.deepEqual(activeReferenceToken("read @src/ma", 12), {
    start: 5,
    end: 12,
    query: "src/ma",
    quoted: false,
  });
  assert.deepEqual(activeReferenceToken('read @"my file', 14), {
    start: 5,
    end: 14,
    query: "my file",
    quoted: true,
  });
  assert.equal(activeReferenceToken("mail@example.com", 16), null);
  assert.equal(formatFileMention({ kind: "file", path: "my file.md" }), '@"my file.md"');
  assert.equal(formatFileMention({ kind: "directory", path: "src" }), "@src/");
});

test("reference candidates preserve canonical session mentions and directory continuation", () => {
  const rows = normalizeReferenceCandidates({
    files: [
      { kind: "directory", path: "src" },
      { kind: "file", path: "src/App.vue" },
    ],
    sessions: [{
      sessionId: "s2",
      label: "Earlier chat",
      cwd: "/workspace",
      mention: "@[Earlier chat](session:s2)",
    }],
  });
  assert.equal(rows[0].mention, "@src/");
  assert.equal(rows[0].continuation, true);
  assert.equal(rows[1].mention, "@src/App.vue");
  assert.equal(rows[2].mention, "@[Earlier chat](session:s2)");

  assert.deepEqual(
    insertReference("read @sr now", { start: 5, end: 8 }, rows[1]),
    { draft: "read @src/App.vue now", caret: 17 },
  );
  assert.equal(referencesUrl("a b", "src/x"), "/api/lares/references?sessionId=a+b&query=src%2Fx");
  assert.deepEqual(
    sessionReferenceCandidates([
      { sessionId: "s1", title: "Current" },
      { sessionId: "s2", title: "Earlier chat", cwd: "/workspace" },
    ], "s1", "earlier"),
    [{
      id: "session:s2",
      kind: "session",
      label: "Earlier chat",
      description: "/workspace",
      mention: "@[Earlier chat](dsh-session:InMyIg)",
      continuation: false,
    }],
  );
});
