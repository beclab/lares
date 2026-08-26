import assert from "node:assert/strict";
import test from "node:test";
import {
  healthPayload,
  isAudioShimPath,
  llmShimSuffix,
  shimBudget,
  shimRequestHeaders,
  shimResponseHeaders,
  SHIM_AUDIO_TIMEOUT_MS,
  SHIM_CHAT_MAX_BYTES,
  SHIM_CHAT_TIMEOUT_MS,
} from "@lares/core/router/shim";
import { STT_MAX_AUDIO_BYTES } from "@lares/core/router/stt";

test("llmShimSuffix strips the Host prefix and query stays with the caller", () => {
  assert.equal(llmShimSuffix("/llm/v1/models"), "models");
  assert.equal(llmShimSuffix("/llm/v1/chat/completions"), "chat/completions");
  assert.equal(llmShimSuffix("/llm/v1/audio/transcriptions"), "audio/transcriptions");
  assert.equal(llmShimSuffix("/llm/v1/"), "");
});

test("audio shim hops get the STT size and timeout budget", () => {
  assert.equal(isAudioShimPath("audio/transcriptions"), true);
  assert.equal(isAudioShimPath("chat/completions"), false);
  assert.deepEqual(shimBudget("audio/transcriptions"), {
    audio: true,
    timeoutMs: SHIM_AUDIO_TIMEOUT_MS,
    maxBytes: STT_MAX_AUDIO_BYTES,
    tooLargeMessage: "audio exceeds 25MB",
  });
  assert.deepEqual(shimBudget("chat/completions"), {
    audio: false,
    timeoutMs: SHIM_CHAT_TIMEOUT_MS,
    maxBytes: SHIM_CHAT_MAX_BYTES,
    tooLargeMessage: "LLM request exceeds 16MB",
  });
});

test("shim request headers drop hop-by-hop and caller identity, then stamp Router auth", () => {
  const headers = shimRequestHeaders(
    {
      host: "lares.example",
      authorization: "Bearer stolen",
      "x-caller-appid": "other",
      "content-type": "application/json",
      "x-request-id": "abc",
    },
    { LARES_ROUTER_API_KEY: "", OLARES_APP_ID: "lares" },
  );
  assert.equal(headers.host, undefined);
  assert.equal(headers.authorization, undefined);
  assert.equal(headers["x-caller-appid"], "lares");
  assert.equal(headers["content-type"], "application/json");
  assert.equal(headers["x-request-id"], "abc");
});

test("shim response headers drop encoding that Node already decoded", () => {
  const headers = shimResponseHeaders({
    "content-type": "application/json",
    "content-encoding": "gzip",
    "transfer-encoding": "chunked",
    connection: "keep-alive",
  });
  assert.deepEqual(headers, { "content-type": "application/json" });
});

test("health payload reports the Router URL without exposing the key", () => {
  const payload = healthPayload({
    LLM_GATEWAY_URL: "http://router.test/v1/",
    OLARES_APP_ID: "lares",
    LARES_ROUTER_API_KEY: "sk-secret",
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.routerUrl, "http://router.test/v1");
  assert.equal(payload.hasRouterKey, true);
  assert.equal(JSON.stringify(payload).includes("sk-secret"), false);
});
