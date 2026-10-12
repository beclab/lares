import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { adaptGeminiChatBody, isGeminiModel } from "@olares/lares-core/router/gemini-schema";
import { proxyToRouter } from "@olares/lares-core/router/shim";

const NESTED = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: { const: "fast", description: "how" },
    files: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        examples: ["a"],
        properties: { name: { type: "string" } },
      },
    },
    choice: { oneOf: [{ type: "string" }, { type: "number" }] },
  },
};

test("gemini model ids are the family, not a substring of another vendor", () => {
  assert.equal(isGeminiModel("gemini/gemini-3.8-flash"), true);
  assert.equal(isGeminiModel("gog/gemini-3.1-pro-preview"), true);
  assert.equal(isGeminiModel("models/gemini-2.5-flash"), true);
  assert.equal(isGeminiModel("Olares/unsloth/Qwen3.6-35B-A3B-GGUF:UD-IQ4_XS"), false);
  assert.equal(isGeminiModel("anthropic/claude-fable-5-1"), false);
});

test("gemini tool schemas keep Schema fields and drop the ones the proto rejects", () => {
  const body = adaptGeminiChatBody({
    model: "gemini/gemini-3.8-flash",
    messages: [{ role: "user", content: "hallo" }],
    tools: [{
      type: "function",
      function: {
        name: "grep",
        description: "search",
        strict: false,
        parameters: NESTED,
      },
    }],
  });
  const fn = body.tools[0].function;
  assert.equal(fn.strict, undefined);
  assert.equal(fn.parameters.additionalProperties, undefined);
  assert.deepEqual(fn.parameters.properties.mode.enum, ["fast"]);
  assert.equal(fn.parameters.properties.mode.const, undefined);
  assert.equal(fn.parameters.properties.files.items.additionalProperties, undefined);
  assert.equal(fn.parameters.properties.files.items.examples, undefined);
  assert.equal(fn.parameters.properties.files.items.properties.name.type, "string");
  assert.deepEqual(fn.parameters.properties.choice.anyOf, [{ type: "string" }, { type: "number" }]);
  assert.equal(fn.parameters.properties.choice.oneOf, undefined);
  assert.equal(NESTED.additionalProperties, false);
});

test("a non-gemini chat body is left byte-for-byte alone", () => {
  const body = {
    model: "Olares/unsloth/Qwen3.6-35B-A3B-GGUF:UD-IQ4_XS",
    tools: [{ type: "function", function: { name: "grep", strict: false, parameters: NESTED } }],
  };
  assert.equal(adaptGeminiChatBody(body), body);
});

test("the shim forwards a gemini chat without additionalProperties or strict", async () => {
  let forwarded = "";
  const router = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      forwarded = Buffer.concat(chunks).toString("utf8");
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"choices":[]}');
    });
  });
  const proxy = createServer((req, res) => {
    proxyToRouter(req, res, {
      LLM_GATEWAY_URL: `http://127.0.0.1:${(router.address()).port}/v1`,
      OLARES_APP_ID: "lares",
    });
  });
  try {
    router.listen(0, "127.0.0.1");
    await once(router, "listening");
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    const status = await new Promise((resolve, reject) => {
      const client = httpRequest({
        host: "127.0.0.1",
        port: proxy.address().port,
        path: "/llm/v1/chat/completions",
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      client.once("error", reject);
      client.once("response", (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      });
      client.end(JSON.stringify({
        model: "gog/gemini-3.8-flash",
        tools: [{
          type: "function",
          function: { name: "glob", strict: false, parameters: { type: "object", additionalProperties: false } },
        }],
      }));
    });
    assert.equal(status, 200);
    const sent = JSON.parse(forwarded);
    assert.equal(sent.tools[0].function.strict, undefined);
    assert.equal(sent.tools[0].function.parameters.additionalProperties, undefined);
    assert.equal(sent.tools[0].function.parameters.type, "object");
  } finally {
    proxy.closeAllConnections();
    router.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => proxy.close(() => resolve())),
      new Promise((resolve) => router.close(() => resolve())),
    ]);
  }
});
