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
        { id: "Qwen/chat", mode: "chat", context_size: 104448, max_output_tokens: 8192 },
        { id: "EmbeddingGemma/embed", mode: "embedding" },
        { id: "Qwen/chat", mode: "chat" },
        { id: "" },
        { id: "unsafe\r\nmodel", mode: "chat" },
      ],
    }),
    [
      {
        id: "Qwen/chat",
        name: "Qwen/chat",
        mode: "chat",
        reasoningEfforts: null,
        contextWindow: 104448,
        maxTokens: 8192,
      },
      {
        id: "EmbeddingGemma/embed",
        name: "EmbeddingGemma/embed",
        mode: "embedding",
        reasoningEfforts: null,
        contextWindow: null,
        maxTokens: null,
      },
    ],
  );
  assert.equal(isChatModelId("Qwen/chat"), true);
  assert.equal(isChatModelId("EmbeddingGemma/embed"), false);
  assert.equal(isChatModelId("Whisper Large"), false);
  assert.equal(
    pickChatModelId([
      { id: "opaque-image-id", name: "x", mode: "image_generation" },
      { id: "opaque-chat-id", name: "y", mode: "chat" },
    ]),
    "opaque-chat-id",
  );
  assert.equal(pickChatModelId([{ id: "opaque-image-id", name: "x", mode: "image_generation" }]), null);
});

test("effort levels travel with the model, and only the ones Router will take", () => {
  assert.deepEqual(
    modelsFromRouterCatalog({
      data: [
        {
          id: "thinks",
          mode: "chat",
          supports: ["reasoning", "reasoning_effort"],
          reasoning_effort: { options: ["low", "medium", "xhigh", "turbo"], default: "xhigh" },
        },
        {
          id: "options-without-support",
          mode: "chat",
          supports: ["reasoning"],
          reasoning_effort: { options: ["low"] },
        },
        { id: "off-only", mode: "chat", supports: ["reasoning_effort"], reasoning_effort: { options: ["off"] } },
      ],
    }).map(({ id, reasoningEfforts }) => ({ id, reasoningEfforts })),
    [
      { id: "thinks", reasoningEfforts: { low: "low", medium: "medium", xhigh: "xhigh" } },
      { id: "options-without-support", reasoningEfforts: null },
      { id: "off-only", reasoningEfforts: null },
    ],
  );
});

test("pickChatModelId prefers the MTP sibling over the plain build", () => {
  const catalog = [
    { id: "EmbeddingGemma/embeddinggemma-300m", name: "x", mode: "embedding" },
    { id: "Qwen3.6-27B (llama.cpp)/unsloth/Qwen3.6-27B-GGUF:Q4_K_M", name: "y", mode: "chat" },
    { id: "Qwen3.6-27B MTP (llama.cpp)/unsloth/Qwen3.6-27B-MTP-GGUF:UD-Q4_K_XL", name: "z", mode: "chat" },
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