import assert from "node:assert/strict";
import test from "node:test";
import {
  isChatModelId,
  isPlaceholderModelId,
  modelsFromRouterCatalog,
  pickChatModelId,
} from "./router-models.js";
import { bootstrapAgentDefaultModel } from "./bootstrap-settings.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("modelsFromRouterCatalog and isChatModelId", () => {
  assert.deepEqual(
    modelsFromRouterCatalog({
      data: [
        { id: "Qwen/chat" },
        { id: "EmbeddingGemma/embed" },
        { id: "Qwen/chat" },
        { id: "" },
      ],
    }),
    [
      { id: "Qwen/chat", name: "Qwen/chat" },
      { id: "EmbeddingGemma/embed", name: "EmbeddingGemma/embed" },
    ],
  );
  assert.equal(isChatModelId("Qwen/chat"), true);
  assert.equal(isChatModelId("EmbeddingGemma/embed"), false);
  assert.equal(isChatModelId("Whisper Large"), false);
  assert.equal(pickChatModelId([{ id: "EmbeddingGemma/embed", name: "x" }, { id: "Qwen/chat", name: "y" }]), "Qwen/chat");
});

test("isPlaceholderModelId", () => {
  assert.equal(isPlaceholderModelId(null), true);
  assert.equal(isPlaceholderModelId("default"), true);
  assert.equal(isPlaceholderModelId("deepseek-v4-flash"), true);
  assert.equal(isPlaceholderModelId("Qwen/chat"), false);
});

test("bootstrapAgentDefaultModel upgrades placeholder settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "dina-settings-"));
  try {
    const first = bootstrapAgentDefaultModel(
      dir,
      [{ id: "Qwen/chat", name: "Qwen/chat" }],
      null,
      "Qwen/chat",
    );
    assert.equal(first.changed, true);
    assert.equal(first.model, "Qwen/chat");
    const yaml = readFileSync(join(dir, "settings.yaml"), "utf8");
    assert.match(yaml, /model: "Qwen\/chat"/);

    const second = bootstrapAgentDefaultModel(
      dir,
      [{ id: "Qwen/chat", name: "Qwen/chat" }],
      null,
      "Qwen/chat",
    );
    assert.equal(second.changed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
