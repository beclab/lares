import assert from "node:assert/strict";
import test from "node:test";
import { APIError } from "openai";
import { isContextWindowExceededError } from "@deepseek-ai/dsh-llm";
import { formatProviderError, normalizeProviderError } from "@earendil-works/pi-ai/utils/error-body";
import { isContextOverflow } from "@earendil-works/pi-ai/utils/overflow";

const googleBody = [{
  error: {
    code: 400,
    message: 'Unknown name "store": Cannot find field.',
    status: "INVALID_ARGUMENT",
  },
}];

function shown(body: unknown): string {
  const error = APIError.generate(400, body, undefined, new Headers());
  return formatProviderError(normalizeProviderError(error));
}

test("a Google array error body is shown and is not a context overflow", () => {
  const message = shown(googleBody);
  assert.match(message, /Unknown name \\?"store\\?"/);
  assert.match(message, /INVALID_ARGUMENT/);
  assert.equal(message.includes("no body"), false);
  assert.equal(isContextWindowExceededError(message), false);
  assert.equal(isContextOverflow({
    stopReason: "error",
    errorMessage: message,
    provider: "olares-router",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  }, 1_048_576), false);
});

test("an ordinary OpenAI error object is unchanged", () => {
  const message = shown({ error: { message: "model not found", type: "invalid_request_error" } });
  assert.match(message, /model not found/);
  assert.equal(message.includes("no body"), false);
});
