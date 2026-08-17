import assert from "node:assert/strict";
import test from "node:test";
import {
  isChatModelId,
  isPlaceholderModelId,
  modelsFromRouterCatalog,
  pickChatModelId,
} from "../../packages/service/olares/router-models.js";
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

test("pickChatModelId prefers the MTP sibling over the plain build", () => {
  const catalog = [
    { id: "EmbeddingGemma/embeddinggemma-300m", name: "x" },
    { id: "Qwen3.6-27B (llama.cpp)/unsloth/Qwen3.6-27B-GGUF:Q4_K_M", name: "y" },
    { id: "Qwen3.6-27B MTP (llama.cpp)/unsloth/Qwen3.6-27B-MTP-GGUF:UD-Q4_K_XL", name: "z" },
  ];
  assert.equal(pickChatModelId(catalog), "Qwen3.6-27B MTP (llama.cpp)/unsloth/Qwen3.6-27B-MTP-GGUF:UD-Q4_K_XL");
  assert.equal(pickChatModelId(catalog.slice(0, 2)), "Qwen3.6-27B (llama.cpp)/unsloth/Qwen3.6-27B-GGUF:Q4_K_M");
});

test("isPlaceholderModelId", () => {
  assert.equal(isPlaceholderModelId(null), true);
  assert.equal(isPlaceholderModelId("default"), true);
  assert.equal(isPlaceholderModelId("deepseek-v4-flash"), true);
  assert.equal(isPlaceholderModelId("Qwen/chat"), false);
});