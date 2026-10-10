import assert from "node:assert/strict";
import test from "node:test";
import { createInboxTracker, normalizeQueueItems } from "@olares/lares-core/larepass/queue";

test("queue rows derive a text preview so the dock can edit them", () => {
  assert.deepEqual(
    normalizeQueueItems([{
      id: "q1",
      placement: "queued",
      content: [{ type: "text", text: "  next  turn " }],
    }]),
    [{
      id: "q1",
      placement: "queued",
      content: [{ type: "text", text: "  next  turn " }],
      text: "  next  turn ",
      preview: "next turn",
    }],
  );
});

test("image-only queue rows stay non-editable", () => {
  const rows = normalizeQueueItems([{
    id: "img",
    content: [{ type: "image", mediaType: "image/png", data: "AA" }],
  }]);
  assert.equal(rows[0].text, null);
  assert.equal(rows[0].preview, "");
  assert.equal(rows[0].placement, "queued");
  assert.deepEqual(normalizeQueueItems([{ placement: "queued" }]), []);
});

const message = (id, text) => ({ id, role: "user", content: [{ type: "text", text }], source: { kind: "user" } });
const splice = (seq, data) => ({ type: "agent/inbox/spliced", seq, data: { target: "next-turn", start: 0, ...data } });

test("a prompt sent mid-turn shows as queued until its turn claims it", () => {
  const inbox = createInboxTracker();
  assert.equal(inbox.apply("s1", [{ type: "turn/start", seq: 4 }, splice(23, { inserted: [message("m1", "voice")] })]), true);
  assert.deepEqual(inbox.queue("s1").map((row) => [row.id, row.text, row.placement]), [["m1", "voice", "queued"]]);
  assert.deepEqual(inbox.queue("s2"), []);
  inbox.apply("s1", [splice(40, { removedCount: 1, inserted: [] })]);
  assert.deepEqual(inbox.queue("s1"), []);
});

test("inbox replays only splices newer than its baseline", () => {
  const inbox = createInboxTracker();
  assert.equal(inbox.seed("s1", { asOfSeq: 30, values: { inbox: { "next-turn": [message("m1", "a")], "next-step": [] } } }), true);
  assert.equal(inbox.apply("s1", [splice(23, { inserted: [message("m1", "a")] })]), false);
  inbox.apply("s1", [splice(31, { start: 1, inserted: [message("m2", "b")] })]);
  assert.deepEqual(inbox.queue("s1").map((row) => row.id), ["m1", "m2"]);
  assert.equal(inbox.seed("s1", { asOfSeq: 20, values: { inbox: { "next-turn": [], "next-step": [] } } }), false);
  assert.deepEqual(inbox.queue("s1").map((row) => row.id), ["m1", "m2"]);
  inbox.apply("s1", [{ type: "agent/inbox/spliced", seq: 32, data: { target: "next-step", start: 0, inserted: [message("m3", "c")] } }]);
  assert.deepEqual(inbox.queue("s1").map((row) => row.id), ["m1", "m2"]);
});
