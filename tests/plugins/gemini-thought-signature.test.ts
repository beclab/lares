import assert from "node:assert/strict";
import test from "node:test";
import { stream } from "@earendil-works/pi-ai/api/openai-completions";

const SIGNATURE = "c2lnbmF0dXJl";

const model = {
  id: "gemini-3.8-flash",
  name: "gemini-3.8-flash",
  api: "openai-completions" as const,
  provider: "openai" as const,
  baseUrl: "http://router.local/v1",
  reasoning: true,
  input: ["text" as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100000,
  maxTokens: 8192,
};

function sse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function chunk(delta: unknown, finish: string | null = null) {
  return {
    id: "chatcmpl-1",
    model: model.id,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

async function readBody(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  if (typeof init?.body === "string") return JSON.parse(init.body);
  if (init?.body instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(init.body));
  const request = input instanceof Request ? input : null;
  if (request) return JSON.parse(await request.clone().text());
  throw new Error("missing request body");
}

async function complete(messages: unknown[], reply: unknown[]) {
  const requests: unknown[] = [];
  const events = [];
  const run = stream(model, { messages } as never, {
    apiKey: "sk-test",
    fetch: async (input, init) => {
      requests.push(await readBody(input, init));
      return sse(reply);
    },
  });
  for await (const event of run) events.push(event);
  const done = events.find((event) => event.type === "done");
  const error = events.find((event) => event.type === "error");
  assert.equal(error, undefined, error?.error?.errorMessage);
  assert.ok(done, "stream did not finish");
  return { requests, message: done.message };
}

const toolReply = [
  chunk({
    role: "assistant",
    tool_calls: [{
      index: 0,
      id: "call_1",
      type: "function",
      function: { name: "glob", arguments: "" },
    }],
  }),
  chunk({
    tool_calls: [{
      index: 0,
      function: { arguments: "{\"pattern\":\"*\"}" },
      extra_content: { google: { thought_signature: SIGNATURE } },
    }],
  }),
  chunk({}, "tool_calls"),
];

test("gemini tool calls keep thought_signature through the next request", async () => {
  const first = await complete(
    [{ role: "user", content: "list the files", timestamp: 1 }],
    toolReply,
  );
  const call = first.message.content.find((block) => block.type === "toolCall");
  assert.equal(call?.thoughtSignature, SIGNATURE);

  const second = await complete(
    [
      { role: "user", content: "list the files", timestamp: 1 },
      first.message,
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "glob",
        content: [{ type: "text", text: "a.txt" }],
        isError: false,
        timestamp: 2,
      },
    ],
    [chunk({ role: "assistant", content: "a.txt" }, "stop")],
  );
  const replayed = second.requests[0].messages.find((message) => message.role === "assistant");
  assert.deepEqual(replayed.tool_calls[0].extra_content, {
    google: { thought_signature: SIGNATURE },
  });
});

test("an encrypted reasoning blob is not sent as a gemini signature", async () => {
  const encrypted = JSON.stringify({ type: "reasoning.encrypted", id: "rs_1", data: "abc" });
  const result = await complete(
    [
      { role: "user", content: "list the files", timestamp: 1 },
      {
        role: "assistant",
        content: [{
          type: "toolCall",
          id: "call_enc",
          name: "glob",
          arguments: { pattern: "*" },
          thoughtSignature: encrypted,
        }],
        api: "openai-completions",
        provider: "openai",
        model: model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: 2,
      },
    ],
    [chunk({ role: "assistant", content: "ok" }, "stop")],
  );
  const replayed = result.requests[0].messages.find((message) => message.role === "assistant");
  assert.equal(replayed.tool_calls[0].extra_content, undefined);
});
