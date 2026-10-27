import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { compactEarlierToolResults, DEVICE_AGENT_TEMPERATURE, DEVICE_AGENT_TOOLS, deviceAgentRequest, keepDeviceTools } from "@olares/lares-core/voice/agent-history";
import { proxyToRouter, setRequestRewrite, setRequestTrace } from "@olares/lares-core/router/shim";
import { DEVICE_AGENT_PROMPT, SPOKEN_PROMPT, spokenReplyRule } from "@olares/lares-core/voice/agent-session";

const long = "result ".repeat(400);
const turn = (text: string, result: string) => [
  { role: "user", content: text },
  { role: "assistant", content: null, tool_calls: [{ id: `c-${text}`, type: "function", function: { name: "web_search", arguments: "{}" } }] },
  { role: "tool", tool_call_id: `c-${text}`, content: result },
  { role: "assistant", content: `answer to ${text}` },
];

test("only long tool results from before the latest user message are shortened, the same way every time", () => {
  const history = [{ role: "system", content: "rules" }, ...turn("weather", long), ...turn("short", "ok"), { role: "user", content: "light" }];
  const { messages, compacted } = compactEarlierToolResults(history);
  assert.equal(compacted, 1);
  assert.match(messages[3].content, /^\[Earlier tool result of 2800 characters omitted/);
  assert.equal(messages[7].content, "ok");
  assert.equal(messages[4].content, "answer to weather");
  assert.deepEqual(compactEarlierToolResults(history).messages, messages);
  // The current turn's own results are what the Agent is working on and stay whole.
  const working = [...history, { role: "assistant", content: null, tool_calls: [{ id: "c-now", type: "function", function: { name: "bash", arguments: "{}" } }] }, { role: "tool", tool_call_id: "c-now", content: long }];
  assert.equal(compactEarlierToolResults(working).messages.at(-1).content, long);
  assert.equal(compactEarlierToolResults([{ role: "user", content: "hi" }]).compacted, 0);
});

test("an earlier skill result stays whole, so later turns still have its instructions", () => {
  const skill = "<skill_content name=\"ha-lighting\">" + "example ".repeat(400);
  const history = [
    { role: "system", content: "rules" },
    { role: "user", content: "开灯" },
    { role: "assistant", content: null, tool_calls: [{ id: "c-skill", type: "function", function: { name: "skill", arguments: "{\"name\":\"ha-lighting\"}" } }] },
    { role: "tool", tool_call_id: "c-skill", content: skill },
    ...turn("weather", long).slice(1),
    { role: "user", content: "把灯变成黄色" },
  ];
  const { messages, compacted } = compactEarlierToolResults(history);
  assert.equal(messages[3].content, skill);
  assert.equal(compacted, 1);
  assert.match(messages[5].content, /omitted/);
});

test("the shim sends Router the rewritten request of a Session the rewrite claims: compacted history and the device temperature", async () => {
  const seen: any[] = [];
  const router = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => { seen.push({ length: Number(req.headers["content-length"]), body: Buffer.concat(chunks) }); res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
  });
  const proxy = createServer((req, res) => proxyToRouter(req, res, { LLM_GATEWAY_URL: `http://127.0.0.1:${(router.address() as { port: number }).port}/v1`, OLARES_APP_ID: "lares" }));
  const traced: any[] = [];
  setRequestRewrite((sessionId: string, request: any) => sessionId === "device" ? deviceAgentRequest(request) : request);
  setRequestTrace((sessionId: string, messages: any[]) => traced.push([sessionId, messages.length]));
  const send = (sessionId: string) => new Promise<void>((resolve, reject) => {
    const body = JSON.stringify({ model: "m", messages: [...turn("weather", long), { role: "user", content: "light" }] });
    const client = httpRequest({ host: "127.0.0.1", port: (proxy.address() as { port: number }).port, path: "/llm/v1/chat/completions", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), "x-session-id": sessionId } });
    client.once("error", reject);
    client.once("response", (response) => { response.resume(); response.on("end", () => resolve()); });
    client.end(body);
  });
  try {
    router.listen(0, "127.0.0.1"); await once(router, "listening");
    proxy.listen(0, "127.0.0.1"); await once(proxy, "listening");
    await send("device"); await send("other");
    const [device, other] = seen.map((item) => ({ length: item.length, request: JSON.parse(item.body.toString("utf8")) }));
    assert.match(device.request.messages[2].content, /omitted/);
    assert.equal(device.length, Buffer.byteLength(JSON.stringify(device.request)));
    assert.equal(other.request.messages[2].content, long);
    assert.equal(device.request.temperature, DEVICE_AGENT_TEMPERATURE);
    assert.equal(other.request.temperature, undefined);
    assert.deepEqual(traced, [["device", 5], ["other", 5]]);
  } finally {
    setRequestRewrite(null); setRequestTrace(null);
    proxy.closeAllConnections(); router.closeAllConnections();
    await Promise.all([new Promise<void>((resolve) => proxy.close(() => resolve())), new Promise<void>((resolve) => router.close(() => resolve()))]);
  }
});

test("a device's Agent keeps home control, lookups and reminders, and nothing else", () => {
  const all = ["ask_user_question", "bash", "create_goal", "edit", "media_generate", "read", "schedule_create", "schedule_delete", "schedule_list", "schedule_update", "skill", "subagent", "todo_write", "web_fetch", "web_search", "workflow", "write"].map((name) => ({ name, parameters: {} }));
  assert.deepEqual(keepDeviceTools(all).map((tool) => tool.name), ["bash", "read", "schedule_create", "schedule_delete", "schedule_list", "schedule_update", "skill", "web_fetch", "web_search"]);
  assert.equal(DEVICE_AGENT_TOOLS.length, 9);
  assert.deepEqual(keepDeviceTools([{ type: "function", function: { name: "bash" } }, { type: "function", function: { name: "write" } }]).length, 1);
});

test("a device's Agent is told outside facts come from web_search; Lares's own voice clients keep the plain spoken rule", () => {
  assert.equal(spokenReplyRule({ device: true }), `${DEVICE_AGENT_PROMPT} ${SPOKEN_PROMPT}`);
  assert.match(spokenReplyRule({ device: true, voice: true }), /web_search/);
  assert.equal(spokenReplyRule({ voice: true }), SPOKEN_PROMPT);
  assert.equal(spokenReplyRule({}), "");
});
