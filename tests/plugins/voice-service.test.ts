import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVoiceRecords } from "@olares/lares-core/voice/records";
import { createVoiceDialogue, voiceChat } from "@olares/lares-core/voice/dialogue";
import { createVoiceHostService } from "@olares/lares-core/voice/host-service";

function store() {
  const directory = mkdtempSync(join(tmpdir(), "voice-records-"));
  return { records: createVoiceRecords({ directory }), close: () => rmSync(directory, { recursive: true, force: true }) };
}
test("records isolate owners, deduplicate append and reject stale summaries", () => {
  const h = store();
  try {
    const record = { id: "one", voiceId: "voice", clientId: "phone", turnId: "turn", role: "user", text: "cost matters", audio: "must not persist" };
    const first = h.records.append("alice", "chat", record);
    assert.equal(first.version, 1);
    assert.equal(h.records.append("alice", "chat", record).records.length, 1);
    assert.equal(h.records.read("bob", "chat").records.length, 0);
    assert.equal("audio" in first.records[0], false);
    h.records.append("alice", "chat", { ...record, id: "two", clientId: "web" });
    assert.throws(() => h.records.checkpoint("alice", "chat", "stale", 1), /voice_summary_conflict/);
    assert.equal(h.records.read("alice", "chat").records.length, 2);
    h.records.clear("bob", "chat");
    assert.equal(h.records.read("alice", "chat").records.length, 2);
    h.records.clear("alice", "chat");
    assert.equal(h.records.read("alice", "chat").records.length, 0);
  } finally { h.close(); }
});
test("chat preset cannot delegate even if its model emits a tool", async () => {
  let delegated = 0;
  const dialogue = createVoiceDialogue({ config: { preset: "chat" }, owner: "alice", submit: async () => { delegated++; },
    chat: async () => ({ tool_calls: [{ id: "tool", function: { name: "ask_lares", arguments: '{"task":"do it"}' } }] }),
  });
  await assert.rejects(dialogue.reply("hi", "request"), /voice_tool_forbidden/);
  assert.equal(delegated, 0);
});
test("assistant delegates a controlled task and describes pending without claiming completion", async () => {
  const submitted: any[] = [];
  let count = 0;
  const dialogue = createVoiceDialogue({ config: { preset: "assistant" }, agent: true, owner: "alice",
    submit: async (...args: any[]) => { submitted.push(args); return { status: "pending", requestId: "task" }; },
    chat: async ({ messages }: any) => {
      if (++count === 1) return { role: "assistant", content: null, tool_calls: [{ id: "tool", function: { name: "ask_lares", arguments: '{"task":"check resources"}' } }] };
      assert.equal(JSON.parse(messages.at(-1).content).status, "pending");
      return { role: "assistant", content: "The check is still running." };
    },
  });
  assert.deepEqual(await dialogue.reply("check", "one"), { text: "The check is still running.", calls: [] });
  assert.deepEqual(submitted, [["check resources", "one", "run"]]);
});
test("pure chat does not create or inspect a business session and repeated turns are deduplicated", async () => {
  const h = store();
  let creates = 0, replies = 0;
  const api = { create: async () => { creates++; throw new Error("unexpected"); } };
  const service = createVoiceHostService(api, { records: h.records, config: () => ({ preset: "chat" }),
    chat: async () => { replies++; return { role: "assistant", content: "hello" }; },
  });
  const scope: any = { id: "client-one", owner: "alice" };
  try {
    await service.open(scope, {});
    await service.prompt(scope, { text: "hi", requestId: "one" });
    await service.prompt(scope, { text: "hi", requestId: "one" });
    // One reply for the deduplicated turn; the history summary waits for a quiet spell.
    assert.equal(creates, 0); assert.equal(replies, 1);
    assert.equal(service.state(scope).utterance.text, "hello");
    assert.equal(service.records(scope).records.length, 2);
    await service.clearRecords(scope);
    // Closing writes the pending summary instead of dropping it.
    assert.equal(replies, 2);
    assert.equal(service.records(scope).records.length, 0);
    await service.close(scope);
  } finally { h.close(); }
});

test("closing while authorization is pending cannot activate a late voice session", async () => {
  const h = store();
  let authorize: () => void = () => {};
  const service = createVoiceHostService({ inspect: () => new Promise<void>((resolve) => { authorize = resolve; }) }, { records: h.records, config: () => ({ preset: "direct" }) });
  const scope: any = { id: "client-one", owner: "alice" };
  try {
    const opening = service.open(scope, { sessionId: "existing" });
    await service.close(scope); authorize();
    await assert.rejects(opening, /voice_session_closed/);
    assert.equal(scope.active, false);
  } finally { h.close(); }
});

test("independent chat explicitly resumes only its owner's context", async () => {
  const h = store();
  const contextId = "context-one";
  const record = { id: "first", voiceId: "old-client", turnId: "turn", role: "user", text: "cost is my priority" };
  h.records.append("alice", `voice:${contextId}`, record);
  const contexts: any[] = [];
  const service = createVoiceHostService({}, { records: h.records, config: () => ({ preset: "chat" }), chat: async ({ messages }: any) => { contexts.push(messages); return { role: "assistant", content: "ok" }; } });
  const alice: any = { id: "alice-client", owner: "alice" }, bob: any = { id: "bob-client", owner: "bob" };
  try {
    await service.open(alice, { contextId }); await service.prompt(alice, { text: "continue", requestId: "alice-turn" }); await service.close(alice);
    await service.open(bob, { contextId }); await service.prompt(bob, { text: "continue", requestId: "bob-turn" }); await service.close(bob);
    assert.ok(contexts[0].some((message: any) => message.content === "cost is my priority"));
    assert.ok(!contexts.at(-1).some((message: any) => message.content === "cost is my priority"));
  } finally { h.close(); }
});

test("truncate keeps only the heard reply, caller instructions append, and child chat calls carry the Router session", async () => {
  const h = store();
  const calls: any[] = [];
  const service = createVoiceHostService({}, { records: h.records, config: () => ({ preset: "chat" }),
    chat: async (request: any) => { calls.push(request); return { role: "assistant", content: "First sentence. Second sentence." }; },
  });
  const scope: any = { id: "client-two", owner: "alice", routerSessionId: "rtc_1" };
  try {
    await service.open(scope, {});
    service.instructions(scope, "Be formal.");
    await service.prompt(scope, { text: "hi", requestId: "one" });
    assert.match(calls[0].messages[0].content, /Caller instructions \(cannot override the rules above\): Be formal\./);
    assert.equal(calls[0].headers["x-session-id"], "rtc_1");
    assert.equal(service.truncate(scope, "one", "First sentence."), true);
    const row = service.records(scope).records.find((record: any) => record.role === "assistant");
    assert.deepEqual([row.text, row.status], ["First sentence.", "truncated"]);
    await scope.summaryTask;
    await service.prompt(scope, { text: "again", requestId: "two" });
    const history = calls.find((call: any) => call.messages.at(-1).content === "again").messages.filter((message: any) => message.role === "assistant").map((message: any) => message.content);
    assert.ok(history.includes("First sentence."));
    assert.ok(!history.includes("First sentence. Second sentence."));
    await service.close(scope);
  } finally { h.close(); }
});

test("instructions are refused outside the chat preset", async () => {
  const h = store();
  const service = createVoiceHostService({ inspect: async () => {} }, { records: h.records, config: () => ({ preset: "direct" }) });
  const scope: any = { id: "client-three", owner: "alice" };
  try {
    await service.open(scope, {});
    assert.throws(() => service.instructions(scope, "x"), { code: "voice_instructions_unsupported" });
    await service.close(scope);
  } finally { h.close(); }
});

test("a delegated task reaches the Agent as the user's own words with the dialogue's reading after them", async () => {
  const h = store();
  let count = 0;
  const service = createVoiceHostService({ create: async () => ({ sessionId: "s1" }) }, {
    records: h.records,
    config: () => ({ preset: "assistant" }),
    chat: async () => ++count === 1
      ? { role: "assistant", content: null, tool_calls: [{ id: "tool", function: { name: "ask_lares", arguments: '{"operation":"run","task":"Check tomorrow\'s weather in Beijing"}' } }] }
      : { role: "assistant", content: "Checking." },
  });
  const scope: any = { id: "client-one", owner: "alice" };
  const submitted: string[] = [];
  try {
    await service.open(scope, {});
    scope.session = { snapshot: () => ({ running: false, sessionId: "s1", cursor: 0, tasks: [] }), submit: async (text: string) => { submitted.push(text); return { sessionId: "s1" }; }, close: async () => {} };
    await service.prompt(scope, { text: "Beijing", requestId: "one" });
    assert.deepEqual(submitted, ["Beijing\n\n(Voice assistant's reading of this request: Check tomorrow's weather in Beijing)"]);
  } finally { h.close(); }
});

test("reading the voice state neither consumes nor duplicates the pending result", async () => {
  const h = store();
  const service = createVoiceHostService({ create: async () => ({ sessionId: "s1" }) }, {
    records: h.records,
    config: () => ({ preset: "assistant" }),
    chat: async () => ({ role: "assistant", content: "ok" }),
  });
  const scope: any = { id: "client-one", owner: "alice" };
  try {
    await service.open(scope, {});
    let task: any = { requestId: "r1", status: "running", text: "", error: null, turn: 1 };
    scope.session = { snapshot: () => ({ running: false, sessionId: "s1", cursor: 3, tasks: [task] }), close: async () => {} };
    service.advance(scope);
    // Still running: nothing is spoken yet, but the view stays pure.
    assert.equal(service.state(scope).utterance, null);
    task = { ...task, status: "completed", text: "done" };
    const first = service.state(scope);
    const second = service.state(scope);
    assert.equal(first.utterance?.key, "task:r1");
    assert.deepEqual(second.utterance, first.utterance);
    // Repeated reads never re-consume, and repeated events never duplicate the record.
    service.advance(scope);
    assert.deepEqual(service.state(scope).utterance, first.utterance);
    assert.equal(scope.voiceResults.length, 0);
    assert.equal(service.records(scope).records.filter((row: any) => row.role === "task").length, 1);
  } finally { h.close(); }
});

const MOVE = { name: "move_head", description: "Move the head", parameters: { type: "object", properties: {} } };
const call = (id: string, name: string, args = "{}") => ({ id, type: "function", function: { name, arguments: args } });

test("device tools end the step, answer through outputs and give up unanswered calls before the next turn", async () => {
  const requests: any[] = [];
  const answers: any[] = [
    { role: "assistant", content: "Sure.", tool_calls: [call("c1", "move_head")] },
    { role: "assistant", content: "Done." },
    { role: "assistant", content: null, tool_calls: [call("c2", "move_head")] },
    { role: "assistant", content: "Hello again." },
  ];
  const dialogue = createVoiceDialogue({ config: {}, agent: true, owner: "alice", submit: async () => ({}), chat: async (request: any) => { requests.push(structuredClone(request)); return answers.shift(); } });
  assert.ok(!requests.length);
  dialogue.setClientTools([MOVE]);
  assert.ok(dialogue.hasClientTools());
  assert.deepEqual(await dialogue.reply("nod", "t1"), { text: "Sure.", calls: [{ call_id: "c1", name: "move_head", arguments: "{}" }] });
  assert.deepEqual(requests[0].tools.map((tool: any) => tool.function.name), ["ask_lares", "move_head"]);
  assert.equal(requests[0].maxCalls, 8);
  assert.match(requests[0].messages[0].content, /Saying an action does not perform it/);
  assert.equal(dialogue.toolOutput("c1", '{"ok":true}'), true);
  assert.deepEqual(await dialogue.reply(null, "t2"), { text: "Done.", calls: [] });
  // The per-turn language hint follows; the call and its output come before the continuation's cue.
  const turn = requests[1].messages;
  assert.deepEqual(turn.slice(-3).map((item: any) => [item.role, item.tool_call_id ?? null]), [["assistant", null], ["tool", "c1"], ["user", null]]);
  assert.match(turn.at(-1).content, /from the device result above in one short sentence/);
  await dialogue.reply("again", "t3");
  // c2 never got an output: the next turn records that instead of leaving the pair open.
  await dialogue.reply("hello", "t4");
  const owed = requests[3].messages.find((item: any) => item.tool_call_id === "c2");
  assert.match(owed.content, /no result/);
  assert.equal(dialogue.toolOutput("c2", "late"), false);
  assert.throws(() => dialogue.toolOutput("c9", "x"), { code: "voice_tool_unknown" });
});

test("continuations stop offering tools after three steps and a newer camera frame replaces the older one", async () => {
  const requests: any[] = [];
  const dialogue = createVoiceDialogue({ config: {}, owner: "alice", chat: async (request: any) => { requests.push(structuredClone(request)); return { role: "assistant", content: "ok" }; } });
  dialogue.setClientTools([MOVE]);
  dialogue.observe([{ type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } }]);
  dialogue.observe([{ type: "image_url", image_url: { url: "data:image/jpeg;base64,BBBB" } }]);
  for (let i = 0; i < 3; i++) await dialogue.reply(null, `c${i}`);
  assert.deepEqual(requests.map((request: any) => request.toolChoice ?? "auto"), ["auto", "auto", "none"]);
  const images = JSON.stringify(requests[0].messages);
  assert.ok(images.includes("BBBB") && !images.includes("AAAA"));
});

test("a delegation batched with a device call still lets the dialogue speak about the delegation", async () => {
  const requests: any[] = [];
  const submitted: any[] = [];
  const answers: any[] = [
    { role: "assistant", content: null, tool_calls: [call("own", "ask_lares", '{"operation":"run","task":"turn on the light"}'), call("dev", "move_head")] },
    { role: "assistant", content: "Turning it on." },
  ];
  const dialogue = createVoiceDialogue({ config: {}, agent: true, owner: "alice", submit: async (...args: any[]) => { submitted.push(args); return { status: "pending" }; }, chat: async (request: any) => { requests.push(structuredClone(request)); return answers.shift(); } });
  dialogue.setClientTools([MOVE]);
  assert.deepEqual(await dialogue.reply("light", "t1"), { text: "Turning it on.", calls: [{ call_id: "dev", name: "move_head", arguments: "{}" }] });
  assert.deepEqual(submitted, [["turn on the light", "t1", "run"]]);
  // The follow-up offers exactly the tools the delegating call had, so a chat template that renders
  // tools ahead of the conversation keeps the cached prefix.
  assert.deepEqual(requests[1].tools.map((tool: any) => tool.function.name), requests[0].tools.map((tool: any) => tool.function.name));
  assert.deepEqual(requests[1].tools.map((tool: any) => tool.function.name), ["ask_lares", "move_head"]);
  // The device call was answered with a placeholder already, so its real output arrives late.
  assert.equal(dialogue.toolOutput("dev", "{}"), false);
});

test("without device tools the dialogue prompt and tools stay exactly as before", async () => {
  const requests: any[] = [];
  const dialogue = createVoiceDialogue({ config: {}, agent: true, owner: "alice", chat: async (request: any) => { requests.push(request); return { role: "assistant", content: "ok" }; } });
  await dialogue.reply("hi", "t1");
  assert.doesNotMatch(requests[0].messages[0].content, /Saying an action does not perform it/);
  assert.deepEqual(requests[0].tools.map((tool: any) => tool.function.name), ["ask_lares"]);
  assert.equal(requests[0].maxCalls, 1);
});

test("a device session hears a finished task through the dialogue, which may act on it", async () => {
  const h = store();
  const requests: any[] = [];
  const service = createVoiceHostService({ create: async () => ({ sessionId: "s1" }) }, {
    records: h.records,
    config: () => ({ preset: "assistant" }),
    chat: async (request: any) => { requests.push(structuredClone(request)); return { role: "assistant", content: "It will rain.", tool_calls: [call("sad", "move_head")] }; },
  });
  const scope: any = { id: "client-one", owner: "alice", authorizedBinding: { clientTools: true } };
  try {
    await service.open(scope, {});
    service.tools(scope, [MOVE]);
    const task: any = { requestId: "r1", status: "completed", text: "Rain tomorrow.", error: null, turn: 1 };
    scope.session = { snapshot: () => ({ running: false, sessionId: "s1", cursor: 3, tasks: [task] }), close: async () => {} };
    service.advance(scope);
    await scope.voiceSerial;
    const { utterance } = service.state(scope);
    assert.deepEqual([utterance.key, utterance.text, utterance.calls.map((item: any) => item.name)], ["task:r1", "It will rain.", ["move_head"]]);
    assert.match(requests[0].messages.at(-1).content, /task has just finished/);
    assert.ok(requests[0].messages.some((item: any) => /Rain tomorrow/.test(item.content)));
    assert.ok(!service.records(scope).records.some((row: any) => row.text === "Rain tomorrow." && row.role === "assistant"));
  } finally { h.close(); }
});

test("tools and caller instructions on the assistant need the device grant", async () => {
  const h = store();
  const service = createVoiceHostService({ create: async () => ({ sessionId: "s1" }) }, { records: h.records, config: () => ({ preset: "assistant" }), chat: async () => ({ role: "assistant", content: "ok" }) });
  const plain: any = { id: "plain", owner: "alice" }, device: any = { id: "device", owner: "alice", authorizedBinding: { clientTools: true } };
  try {
    await service.open(plain, {}); await service.open(device, {});
    assert.throws(() => service.tools(plain, [MOVE]), { code: "voice_tools_unsupported" });
    assert.throws(() => service.instructions(plain, "x"), { code: "voice_instructions_unsupported" });
    service.tools(device, [MOVE]);
    service.instructions(device, "y".repeat(5000));
  } finally { h.close(); }
});

test("the history summary waits until turns stop instead of following every one", async () => {
  const h = store();
  const calls: string[] = [];
  const service = createVoiceHostService({}, { records: h.records, config: () => ({ preset: "chat" }), summaryIdleMs: 30,
    chat: async ({ messages }: any) => { calls.push(/Summarize/.test(messages[0].content) ? "summary" : "reply"); return { role: "assistant", content: "ok" }; },
  });
  const scope: any = { id: "client-four", owner: "alice" };
  try {
    await service.open(scope, {});
    for (const id of ["a", "b", "c"]) await service.prompt(scope, { text: id, requestId: id });
    assert.deepEqual(calls, ["reply", "reply", "reply"]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await scope.summaryTask;
    assert.deepEqual(calls, ["reply", "reply", "reply", "summary"]);
    await service.close(scope);
    assert.equal(calls.filter((call) => call === "summary").length, 1);
  } finally { h.close(); }
});

test("a whitespace-only answer next to a device call is not spoken", async () => {
  const dialogue = createVoiceDialogue({ config: {}, owner: "alice", chat: async () => ({ role: "assistant", content: "\n\n", tool_calls: [call("c1", "move_head")] }) });
  dialogue.setClientTools([MOVE]);
  assert.deepEqual(await dialogue.reply("nod", "t1"), { text: "", calls: [{ call_id: "c1", name: "move_head", arguments: "{}" }] });
});

test("a device session routes home control and lookups to ask_lares and answers in the user's language", async () => {
  const requests: any[] = [];
  const dialogue = createVoiceDialogue({ config: {}, agent: true, owner: "alice", submit: async () => ({ status: "pending" }), chat: async (request: any) => { requests.push(structuredClone(request)); return { role: "assistant", content: "好的" }; } });
  dialogue.setClientTools([MOVE]);
  dialogue.setInstructions("You are Reachy Mini, a friendly robot. Speak English.", 8000);
  await dialogue.reply("帮我开下灯", "t1");
  const prompt = requests[0].messages[0].content;
  assert.match(prompt, /lights, switches or climate/);
  assert.match(prompt, /Never say you cannot do something before asking ask_lares/);
  // The reminder follows the caller's persona, so the last word on language is the user's.
  assert.ok(prompt.indexOf("Reply in the same language as the user's latest message") > prompt.indexOf("Speak English."));
  const ask = requests[0].tools.find((tool: any) => tool.function.name === "ask_lares");
  assert.match(ask.function.description, /home devices such as lights/);
  assert.match(ask.function.description, /calendar, schedules, reminders/);
});

test("sessions without device tools get neither the device rules nor the reminder", async () => {
  const requests: any[] = [];
  const dialogue = createVoiceDialogue({ config: {}, agent: true, owner: "alice", chat: async (request: any) => { requests.push(request); return { role: "assistant", content: "ok" }; } });
  dialogue.setInstructions("Be formal.");
  await dialogue.reply("hi", "t1");
  const prompt = requests[0].messages[0].content;
  assert.doesNotMatch(prompt, /Saying an action does not perform it|Reply in the same language as the user/);
});

test("only the leading message reaches the model as system, so strict chat templates accept task results", async () => {
  const requests: any[] = [];
  const dialogue = createVoiceDialogue({ config: {}, agent: true, owner: "alice", chat: async (request: any) => { requests.push(structuredClone(request)); return { role: "assistant", content: "ok" }; } });
  await dialogue.reply("turn on the light", "t1");
  dialogue.observeTask({ requestId: "r1", status: "completed", text: "Light is on." });
  await dialogue.reply("thanks", "t2");
  dialogue.setClientTools([MOVE]);
  dialogue.observeTask({ requestId: "r2", status: "completed", text: "Rain tomorrow." });
  await dialogue.reply(null, "task:r2", undefined, undefined, { announce: true });
  for (const request of requests.slice(1)) {
    assert.deepEqual(request.messages.map((item: any, index: number) => index === 0 ? item.role : item.role === "system"), ["system", ...request.messages.slice(1).map(() => false)]);
  }
  const note = requests[1].messages.find((item: any) => /Light is on/.test(JSON.stringify(item.content)));
  assert.equal(note.role, "user");
  assert.match(note.content, /^\[Lares note, not said by the user\] Authorized Lares task result/);
});

test("voice chat turns reasoning off and drops the knob for a model whose card refuses it", async () => {
  const bodies: any[] = [];
  const fetch = async (_url: string, init: any) => {
    const body = JSON.parse(init.body); bodies.push(body);
    if (body.model === "strict" && body.reasoning_effort) return Response.json({ error: { code: "invalid_parameter_value", message: "reasoning_effort=\"none\" is not one of the values this model accepts" } }, { status: 400 });
    return Response.json({ choices: [{ message: { role: "assistant", content: "ok" } }] });
  };
  const env = { LLM_GATEWAY_URL: "http://router.test/v1" } as any;
  assert.equal((await voiceChat({ model: "thinker", messages: [], reasoningEffort: "none", env, fetch })).content, "ok");
  assert.equal(bodies[0].reasoning_effort, "none");
  assert.equal((await voiceChat({ model: "strict", messages: [], reasoningEffort: "none", env, fetch })).content, "ok");
  assert.deepEqual(bodies.slice(1).map((body) => body.reasoning_effort ?? null), ["none", null]);
  // Remembered: the next call to that model does not ask again.
  await voiceChat({ model: "strict", messages: [], reasoningEffort: "none", env, fetch });
  assert.equal(bodies.at(-1).reasoning_effort, undefined);
  assert.equal(bodies.length, 4);
});

test("reasoning a parser left in the content is never spoken", async () => {
  const env = { LLM_GATEWAY_URL: "http://router.test/v1" } as any;
  const plain = async () => Response.json({ choices: [{ message: { role: "assistant", content: "Thinking it over\n</think>\n\n好的，马上开灯。" } }] });
  assert.equal((await voiceChat({ messages: [], env, fetch: plain as any })).content, "好的，马上开灯。");
  const sse = ["好的", "\n</think>\n\n", "马上开灯。"].map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`).join("") + "data: [DONE]\n";
  const streamed = async () => new Response(sse, { headers: { "content-type": "text/event-stream" } });
  const partials: string[] = [];
  assert.equal((await voiceChat({ messages: [], env, fetch: streamed as any, onDelta: (text: string) => partials.push(text) })).content, "马上开灯。");
  assert.ok(!partials.at(-1)?.includes("</think>"));
});

test("a model that asks for ask_lares again after delegating is made to answer instead of failing the turn", async () => {
  const requests: any[] = [];
  const answers: any[] = [
    { role: "assistant", content: null, tool_calls: [call("own", "ask_lares", '{"operation":"run","task":"turn off the light"}')] },
    { role: "assistant", content: null, tool_calls: [call("again", "ask_lares", '{"operation":"status"}')] },
    { role: "assistant", content: "好的，正在关灯。" },
  ];
  const dialogue = createVoiceDialogue({ config: {}, agent: true, owner: "alice", submit: async () => ({ status: "pending" }), chat: async (request: any) => { requests.push(structuredClone(request)); return answers.shift(); } });
  dialogue.setClientTools([MOVE]);
  assert.deepEqual(await dialogue.reply("关灯", "t1"), { text: "好的，正在关灯。", calls: [] });
  assert.equal(requests[2].toolChoice, "none");
  assert.ok(requests.every((request: any) => request.reasoningEffort === "none"));
});

test("past the step limit a call the model makes anyway is dropped and its words are kept", async () => {
  const dialogue = createVoiceDialogue({ config: {}, owner: "alice", chat: async () => ({ role: "assistant", content: "Done for now.", tool_calls: [call("x", "move_head")] }) });
  dialogue.setClientTools([MOVE]);
  for (let i = 0; i < 2; i++) await dialogue.reply(null, `c${i}`);
  assert.deepEqual(await dialogue.reply(null, "c2"), { text: "Done for now.", calls: [] });
});

test("a device turn sends the same system prompt every time, announcements included, so its prefix stays cached", async () => {
  const requests: any[] = [];
  const context = [{ role: "user", text: "Hello, please open the lights." }, { role: "assistant", text: "Done, lights on." }];
  const dialogue = createVoiceDialogue({ config: {}, agent: true, owner: "alice", context, submit: async () => ({ status: "pending" }), chat: async (request: any) => { requests.push(structuredClone(request)); return { role: "assistant", content: "好的" }; } });
  dialogue.setClientTools([MOVE]);
  await dialogue.reply("你能把灯关了吗？", "t1");
  dialogue.observeTask({ requestId: "r1", status: "completed", text: "## Light\n- off" });
  await dialogue.reply(null, "task:r1", undefined, undefined, { announce: true });
  await dialogue.reply("Thanks!", "t2");
  assert.equal(new Set(requests.map((request: any) => request.messages[0].content)).size, 1);
  assert.ok(!requests.some((request: any) => request.messages.some((item: any) => /latest message is in/.test(String(item.content)))));
});

test("a run is acknowledged before the Agent starts, and history keeps the real submission", async () => {
  const order: string[] = [];
  const requests: any[] = [];
  const answers: any[] = [
    { role: "assistant", content: null, tool_calls: [call("own", "ask_lares", '{"operation":"run","task":"turn on the light"}')] },
    { role: "assistant", content: "好的，正在开灯。" },
    { role: "assistant", content: "ok" },
  ];
  const dialogue = createVoiceDialogue({ config: {}, agent: true, owner: "alice",
    submit: async () => { order.push("submit"); return { status: "pending", requestId: "r9:delegate" }; },
    chat: async (request: any) => { order.push("chat"); requests.push(structuredClone(request)); return answers.shift(); } });
  dialogue.setClientTools([MOVE]);
  assert.equal((await dialogue.reply("开灯", "r9")).text, "好的，正在开灯。");
  assert.deepEqual(order, ["chat", "chat", "submit"]);
  // The pending run is what the acknowledgment answers; a device's cue to keep it short comes after it.
  assert.equal(JSON.parse(requests[1].messages.at(-2).content).status, "pending");
  assert.match(requests[1].messages.at(-1).content, /Lares has started on that/);
  await dialogue.reply("谢谢", "r10");
  // The cue was for that call only.
  assert.ok(!requests[2].messages.some((item: any) => /Lares has started on that/.test(String(item.content))));
  const kept = requests[2].messages.find((item: any) => item.role === "tool" && item.tool_call_id === "own");
  assert.equal(JSON.parse(kept.content).requestId, "r9:delegate");
});

test("a status check still asks the Agent before the dialogue answers", async () => {
  const order: string[] = [];
  const answers: any[] = [
    { role: "assistant", content: null, tool_calls: [call("own", "ask_lares", '{"operation":"status"}')] },
    { role: "assistant", content: "还在处理。" },
  ];
  const dialogue = createVoiceDialogue({ config: {}, agent: true, owner: "alice",
    submit: async () => { order.push("submit"); return { running: true }; },
    chat: async () => { order.push("chat"); return answers.shift(); } });
  dialogue.setClientTools([MOVE]);
  await dialogue.reply("好了吗", "t1");
  assert.deepEqual(order, ["chat", "submit", "chat"]);
});

test("a filler on a device is answered without tools", async () => {
  const requests: any[] = [];
  const dialogue = createVoiceDialogue({ config: {}, agent: true, owner: "alice", chat: async (request: any) => { requests.push(request); return { role: "assistant", content: "嗯？" }; } });
  dialogue.setClientTools([MOVE]);
  for (const filler of ["嗯嗯。", "啊", "Uh...", "哦！"]) await dialogue.reply(filler, filler);
  assert.ok(requests.every((request: any) => request.tools === undefined));
  await dialogue.reply("点点头", "real");
  assert.equal(requests.at(-1).tools.length, 2);
});

test("the history summary is short and runs without reasoning", async () => {
  const requests: any[] = [];
  const dialogue = createVoiceDialogue({ config: {}, owner: "alice", chat: async (request: any) => { requests.push(request); return { role: "assistant", content: "summary" }; } });
  await dialogue.summarize();
  assert.deepEqual([requests[0].maxTokens, requests[0].reasoningEffort], [800, "none"]);
  assert.match(requests[0].messages[0].content, /Maximum 1200 characters/);
});

const CAMERA = { name: "camera", description: "Take a picture", parameters: { type: "object", properties: { question: { type: "string" } } } };
const deviceDialogue = (answers: any[], submitted: any[] = [], live: boolean[] = []) => {
  const requests: any[] = [];
  const dialogue = createVoiceDialogue({ config: {}, agent: true, owner: "alice", submit: async (...args: any[]) => { submitted.push(args); return { status: "pending" }; }, chat: async (request: any) => { live.push(typeof request.onDelta === "function"); requests.push(structuredClone(request)); return answers.shift() ?? { role: "assistant", content: "ok" }; } });
  dialogue.setClientTools([MOVE, CAMERA]);
  return { dialogue, requests };
};

test("a device greeting is answered without tools, even after earlier requests failed", async () => {
  for (const said of ["你好。", "好的，你好。", "Hello Reachy!", "Okay, hello.", "Hi there!", "晚上好呀"]) {
    const { dialogue, requests } = deviceDialogue([{ role: "assistant", content: "你好！" }]);
    await dialogue.reply(said, "t1");
    assert.equal(requests[0].tools, undefined, said);
  }
  const { dialogue, requests } = deviceDialogue([{ role: "assistant", content: "好的" }]);
  await dialogue.reply("你好，帮我开灯", "t1");
  assert.ok(requests[0].tools.length, "a greeting with a request keeps its tools");
});

test("a request to look again that is answered in words is asked again with the camera required", async () => {
  const { dialogue, requests } = deviceDialogue([
    { role: "assistant", content: "我再仔细看看，这其实是一个洗手液瓶。" },
    { role: "assistant", content: null, tool_calls: [call("cam", "camera", '{"question":"这是什么"}')] },
  ]);
  const reply = await dialogue.reply("你再看看，它不是杯子。", "t1");
  assert.deepEqual(reply.calls.map((item) => item.name), ["camera"]);
  assert.equal(reply.text, "");
  assert.deepEqual(requests[1].toolChoice, { type: "function", function: { name: "camera" } });
  // The words that claimed a look never reach history.
  await dialogue.reply("好的", "t2");
  assert.ok(!JSON.stringify(requests.at(-1).messages).includes("洗手液瓶"));
});

test("a home-device action claimed in words is asked again with ask_lares required", async () => {
  const submitted: any[] = [];
  const { dialogue, requests } = deviceDialogue([
    { role: "assistant", content: "正在为您开灯。" },
    { role: "assistant", content: null, tool_calls: [call("own", "ask_lares", '{"operation":"run","task":"开灯"}')] },
    { role: "assistant", content: "好的，交给 Lares 了。" },
  ], submitted);
  const reply = await dialogue.reply("开下灯。", "t1");
  assert.deepEqual(requests[1].toolChoice, { type: "function", function: { name: "ask_lares" } });
  assert.deepEqual(submitted, [["开灯", "t1", "run"]]);
  assert.equal(reply.text, "好的，交给 Lares 了。");
});

test("a change to the light just named, claimed with the light before the verb, is held back and asked again", async () => {
  const submitted: any[] = [];
  const live: boolean[] = [];
  const { dialogue, requests } = deviceDialogue([
    { role: "assistant", content: "将灯光调整为白色中。" },
    { role: "assistant", content: null, tool_calls: [call("own", "ask_lares", '{"operation":"run","task":"把灯调成白色"}')] },
    { role: "assistant", content: "好的。" },
  ], submitted, live);
  await dialogue.reply("能把它变成白色吗？", "t1");
  assert.deepEqual(requests[1].toolChoice, { type: "function", function: { name: "ask_lares" } });
  assert.deepEqual(submitted, [["把灯调成白色", "t1", "run"]]);
  assert.equal(live[0], false);
});

test("a second look answered with only a gesture is asked again with the camera, and curly quotes still read as a claim", async () => {
  const look = deviceDialogue([{ role: "assistant", content: null, tool_calls: [call("nod", "move_head")] }, { role: "assistant", content: null, tool_calls: [call("cam", "camera")] }]);
  assert.deepEqual((await look.dialogue.reply("Look again, it's not a cup.", "t1")).calls.map((item) => item.name), ["camera"]);
  assert.deepEqual(look.requests[1].toolChoice, { type: "function", function: { name: "camera" } });
  const submitted: any[] = [];
  const light = deviceDialogue([{ role: "assistant", content: "Got it! I’ll ask Lares to turn off the light for you." }, { role: "assistant", content: null, tool_calls: [call("own", "ask_lares", '{"operation":"run","task":"turn off the light"}')] }, { role: "assistant", content: "On it." }], submitted);
  await light.dialogue.reply("Turn off the light.", "t1");
  assert.equal(submitted.length, 1);
});

test("the English forms of a second look and a claimed light change are caught too", async () => {
  const look = deviceDialogue([{ role: "assistant", content: "It's a soap bottle." }, { role: "assistant", content: null, tool_calls: [call("cam", "camera")] }]);
  assert.deepEqual((await look.dialogue.reply("Look again, it's not a cup.", "t1")).calls.map((item) => item.name), ["camera"]);
  const submitted: any[] = [];
  const light = deviceDialogue([{ role: "assistant", content: "Got it! I'll turn off the light for you." }, { role: "assistant", content: null, tool_calls: [call("own", "ask_lares", '{"operation":"run","task":"turn off the light"}')] }, { role: "assistant", content: "On it." }], submitted);
  await light.dialogue.reply("Turn off the light.", "t1");
  assert.deepEqual(submitted, [["turn off the light", "t1", "run"]]);
});

test("a model that still refuses the required tool keeps its words, and ordinary replies are not retried", async () => {
  const kept = deviceDialogue([{ role: "assistant", content: "正在为您开灯。" }, { role: "assistant", content: "正在为您开灯。" }]);
  assert.equal((await kept.dialogue.reply("开下灯。", "t1")).text, "正在为您开灯。");
  assert.equal(kept.requests.length, 2);
  const plain = deviceDialogue([{ role: "assistant", content: "我是 Reachy Mini。" }]);
  await plain.dialogue.reply("你是谁？", "t1");
  // "你再看看灯开了没" is about the light, not the camera.
  const light = deviceDialogue([{ role: "assistant", content: "我去问问 Lares。" }]);
  await light.dialogue.reply("你再看看灯开了没", "t1");
  assert.equal(plain.requests.length + light.requests.length, 2);
});

test("a short task result is announced as the Agent wrote it; long, formatted or other-language results are not", async () => {
  const announce = async (result: string, asked = "帮我调成白色的") => {
    const { dialogue, requests } = deviceDialogue([{ role: "assistant", content: "好的" }]);
    await dialogue.reply(asked, "t1");
    dialogue.observeTask({ requestId: "r1", status: "completed", text: result });
    const reply = await dialogue.reply(null, "task:r1", undefined, undefined, { announce: true });
    return { text: reply.text, calls: requests.length };
  };
  assert.deepEqual(await announce("好的，灯光已经调整为明亮的白色，亮度已经调低了（50%）。"), { text: "好的，灯光已经调整为明亮的白色，亮度已经调低了（50%）。", calls: 1 });
  assert.equal((await announce("已为您关闭灯 \"Aqara lumi.light.agl003\"。")).calls, 2);
  assert.equal((await announce("## 北京今日热点\n1. 马拉松")).calls, 2);
  assert.equal((await announce("The lights are now bright white.")).calls, 2);
});

test("a Lares client's announcement still goes through the dialogue model", async () => {
  const requests: any[] = [];
  const dialogue = createVoiceDialogue({ config: {}, agent: true, owner: "alice", chat: async (request: any) => { requests.push(request); return { role: "assistant", content: "灯开了。" }; } });
  await dialogue.reply("开灯", "t1");
  dialogue.observeTask({ requestId: "r1", status: "completed", text: "灯已经打开了。" });
  await dialogue.reply(null, "task:r1", undefined, undefined, { announce: true });
  assert.equal(requests.length, 2);
});

test("only an Agent Session a device's dialogue drives is told its answers are spoken by a device", async () => {
  const h = store();
  const service = createVoiceHostService({ create: async () => ({ sessionId: "s1" }) }, { records: h.records, config: () => ({ preset: "assistant" }), chat: async () => ({ role: "assistant", content: "ok" }) });
  const plain: any = { id: "plain", owner: "alice" }, device: any = { id: "device", owner: "alice", authorizedBinding: { clientTools: true } };
  try {
    await service.open(plain, {}); await service.open(device, {});
    plain.session = { snapshot: () => ({ running: false, sessionId: "agent-plain", tasks: [] }), close: async () => {} };
    device.session = { snapshot: () => ({ running: false, sessionId: "agent-device", tasks: [] }), close: async () => {} };
    assert.equal(service.drivesDevice("agent-device"), false, "no device tools declared yet");
    service.tools(device, [MOVE]);
    assert.equal(service.drivesDevice("agent-device"), true);
    assert.equal(service.drivesDevice("agent-plain"), false);
    assert.equal(service.drivesDevice(undefined), false);
  } finally { h.close(); }
});

test("a device turn that calls a tool nobody declared is told which exist, then asked without tools, instead of failing", async () => {
  const submitted: any[] = [];
  const { dialogue, requests } = deviceDialogue([
    { role: "assistant", content: null, tool_calls: [call("x", "search_web", '{"query":"Beijing weather"}')] },
    { role: "assistant", content: null, tool_calls: [call("own", "ask_lares", '{"operation":"run","task":"Beijing weather today"}')] },
    { role: "assistant", content: "Asking Lares." },
  ], submitted);
  const reply = await dialogue.reply("Beijing, please search the Beijing weather.", "t1");
  assert.equal(reply.text, "Asking Lares.");
  assert.deepEqual(submitted, [["Beijing weather today", "t1", "run"]]);
  assert.match(requests[1].messages.at(-1).content, /Only these tools exist: ask_lares, move_head, camera\. Web search/);
  const stubborn = deviceDialogue([
    { role: "assistant", content: "Searching.", tool_calls: [call("x", "search_web")] },
    { role: "assistant", content: "Searching.", tool_calls: [call("y", "search_web")] },
    { role: "assistant", content: "Still searching.", tool_calls: [call("z", "search_web")] },
  ]);
  assert.deepEqual(await stubborn.dialogue.reply("search the weather", "t1"), { text: "Still searching.", calls: [] });
  assert.equal(stubborn.requests[2].toolChoice, "none");
});

test("a Lares client's session still refuses a tool it never offered", async () => {
  const dialogue = createVoiceDialogue({ config: {}, agent: true, owner: "alice", chat: async () => ({ role: "assistant", content: null, tool_calls: [call("x", "search_web")] }) });
  await assert.rejects(dialogue.reply("search", "t1"), /voice_tool_forbidden/);
});

test("a device request the checks may ask again is read only after its first answer; small talk still streams", async () => {
  const live: Record<string, boolean> = {};
  const dialogue = createVoiceDialogue({ config: {}, agent: true, owner: "alice", submit: async () => ({ status: "pending" }), chat: async (request: any) => {
    const said = request.messages.filter((m: any) => m.role === "user").at(-1).content;
    live[said] ??= typeof request.onDelta === "function";
    return { role: "assistant", content: "好的。" };
  } });
  dialogue.setClientTools([MOVE, CAMERA]);
  await dialogue.reply("把灯调整成黄色。", "t1", undefined, () => {});
  await dialogue.reply("你再看看，它不是杯子。", "t2", undefined, () => {});
  await dialogue.reply("今天心情不错。", "t3", undefined, () => {});
  const first = Object.entries(live).map(([said, streamed]) => [String(said).slice(-12), streamed]);
  assert.deepEqual(first.map(([, streamed]) => streamed), [false, false, true], JSON.stringify(first));
});
