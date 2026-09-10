import assert from "node:assert/strict";
import test from "node:test";
import { normalizeQueueItems } from "@olares/lares-core/larepass/queue";

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
