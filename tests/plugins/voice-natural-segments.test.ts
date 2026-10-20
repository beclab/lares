import assert from "node:assert/strict";
import test from "node:test";
import { createSpeechSegmenter, speechSegments } from "../../packages/core/voice/script.js";

const items = ["鼠（子年）", "牛（丑年）", "虎（寅年）", "兔（卯年）", "龙（辰年）", "蛇（巳年）", "马（午年）", "羊（未年）", "猴（申年）", "鸡（酉年）", "狗（戌年）", "猪（亥年）"];
const list = items.map((s, i) => `${i + 1}. **${s}**`).join("\n");
const policy = "natural";
const body = (parts: string[]) => parts.join("").replace(/[\s；;]/g, "");

test("natural Chinese list batches retain every item and parenthetical explanation", () => {
  const parts = speechSegments(list, { policy });
  assert.equal(parts.length, 4);
  assert.equal(body(parts), items.join(""));
  assert.ok(parts.every(p => p.split("；").filter(Boolean).length === 3));
  assert.deepEqual(speechSegments(list), parts, "the accepted policy is shared by default");
  assert.equal(speechSegments(list, { policy: "legacy" }).length, 12);
});

test("Chinese complete sentences release immediately; commas and open parentheses do not", () => {
  const s = createSpeechSegmenter({ policy });
  assert.deepEqual(s.push("你好，今天"), []);
  assert.deepEqual(s.push("天气很好。"), ["你好，今天天气很好。"]);
  assert.deepEqual(s.push("第二句（里面有。"), []);
  assert.deepEqual(s.push("还有解释）结束。"), ["第二句（里面有。还有解释）结束。"]);
  assert.deepEqual(s.finish(), []);
});

test("short list waiting is bounded at 250ms and never re-batches committed items", () => {
  let time = 0;
  const s = createSpeechSegmenter({ policy, now: () => time });
  assert.deepEqual(s.push("1. 鼠\n2. 牛"), []);
  assert.equal(s.deadline, 250);
  time = 249; assert.deepEqual(s.flush(), []);
  time = 250; assert.deepEqual(s.flush(), ["鼠；"]);
  assert.deepEqual(s.push("\n3. 虎\n4. 兔\n5. 龙"), ["牛；虎；兔；"]);
  assert.deepEqual(s.finish(), ["龙；"]);
});

test("all chunk splits preserve content, clean Markdown/emoji and never replay", () => {
  const text = `## 十二生肖\n\n${list}\n\n结束。数字 3.14，时间 10:30，文件 snake_case。`;
  const whole = speechSegments(text, { policy });
  for (let size = 1; size <= 29; size++) {
    const s = createSpeechSegmenter({ policy }); const out: string[] = [];
    for (let at = 0; at < text.length; at += size) out.push(...s.push(text.slice(at, at + size)));
    out.push(...s.finish());
    assert.equal(body(out), body(whole), `chunk size ${size}`);
    assert.deepEqual(s.finish(), []);
  }
});

test("lists cannot merge across nesting, paragraphs, headings or code", () => {
  const text = "1. 父项\n   - 子项甲\n   - 子项乙\n2. 父项二\n\n## 标题\n\n1. 新列表\n\n```js\nsecret()\n```\n\n1. 最后列表";
  const parts = speechSegments(text, { policy });
  assert.ok(parts.every(p => !p.includes("secret")));
  assert.ok(!parts.some(p => p.includes("父项") && p.includes("子项")));
  assert.ok(!parts.some(p => p.includes("新列表") && p.includes("最后列表")));
});

test("reset discards pending speech and protects decimal/time/URL/English abbreviations", () => {
  const s = createSpeechSegmenter({ policy });
  s.push("1. 旧\n2. 待定"); s.reset();
  assert.deepEqual(s.finish(), []);
  const text = "Dr. Smith uses https://example.com/a_b at 10:30, value 3.14. Next.";
  const result = speechSegments(text, { policy }).join(" ");
  for (const token of ["Dr. Smith", "https://example.com/a_b", "10:30", "3.14"]) assert.ok(result.includes(token), token);
});

test("natural speech holds unresolved references and preserves tables and split emoji", () => {
  for (const text of ["First. [Label. More][doc] Last.\n\n[doc]: https://example.com\n", "First. 👩🏽‍💻 Next. 🇨🇳 Last.", "| 项目 | 内容 |\n| --- | --- |\n| 文件 | snake_case |\n"]) {
    const whole = speechSegments(text, { policy });
    for (let size = 1; size < 10; size++) {
      const s = createSpeechSegmenter({ policy }); const out: string[] = [];
      for (let at = 0; at < text.length; at += size) out.push(...s.push(text.slice(at, at + size)));
      out.push(...s.finish()); assert.equal(body(out), body(whole), `size=${size}, ${text}`);
    }
  }
});

test("Host deadline flushes without new tokens; cancellation and failed attempts cannot flush late", async () => {
  const { createReplyStreamRegistry } = await import("../../packages/core/voice/reply-stream.js");
  const registry = createReplyStreamRegistry({ inspect: async () => ({}), segmenterFactory: () => createSpeechSegmenter({ policy }) });
  const source = { sessionId: "timed", turn: 1, step: 0 };
  const start = (attemptId: string, eligible = true) => registry.frame("timed", { ...source, type: "start", attemptId, speechEligible: eligible });
  const chunk = (attemptId: string, text: string) => registry.frame("timed", { type: "chunk", attemptId, index: 0, chunk: { type: "text-delta", text } });
  try {
    start("one"); chunk("one", "1. 鼠\n2. 牛");
    const abort = new AbortController();
    const stream = (await registry.bind({}, source))(abort.signal);
    const first = await stream.next(); assert.equal(first.value.text, "鼠；");
    const next = stream.next(); abort.abort(); await assert.rejects(next, /voice_cancelled/);
    registry.event("timed", { type: "assistant/message", data: { turn: 1, step: 0, message: { content: [{ type: "text", text: "1. 鼠\n2. 牛" }] } } });
    assert.equal((await stream.next()).done, true);
    start("two", false); chunk("two", "1. 绝不提前朗读\n2. 待定");
    const cancel = new AbortController(); const waiting = (await registry.bind({}, source))(cancel.signal).next();
    cancel.abort(); await assert.rejects(waiting, /voice_cancelled/);
  } finally { registry.close(); }
});

test("buffered fallback and real synthesis request construction use the same candidate text", async (t) => {
  const { speakFromConfig } = await import("../../packages/core/voice/service.js");
  const { createDuplexCoordinator } = await import("../../packages/core/voice/duplex.js");
  const bodies: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url: any, init: any) => {
    bodies.push(JSON.parse(init.body));
    return new Response(new Uint8Array([0, 0]), { headers: { "content-type": "audio/L16", "x-audio-sample-rate": "24000" } });
  });
  const coordinator = createDuplexCoordinator();
  const options = { config: { speak: true, ttsModel: "tts" }, model: "tts", coordinator,
    segmenterFactory: () => createSpeechSegmenter({ policy }), openPlayback: async () => ({ skipped: true }), pcmToWav: (pcm: Buffer) => pcm };
  await speakFromConfig(list, options);
  assert.deepEqual(bodies.map(b => b.input), speechSegments(list, { policy }));
  assert.ok(bodies.every(b => b.model === "tts" && b.response_format === "pcm" && b.stream === undefined));
  bodies.length = 0;
  const keyed = { ...options, coordinator: createDuplexCoordinator(), key: "waiting", done: false };
  assert.deepEqual(await speakFromConfig("1. 鼠\n2. 牛", keyed), { sentences: 1 });
  await speakFromConfig("1. 鼠\n2. 牛", { ...keyed, done: true });
  const result = await speakFromConfig("1. 鼠\n2. 牛", { ...keyed, done: true, part: 1 });
  assert.ok(result.audio);
  assert.deepEqual(bodies.map(b => b.input), ["鼠；", "牛；"]);
});

test("an empty next list marker closes the first item and long units keep safe boundaries", () => {
  const s = createSpeechSegmenter({ policy, now: () => 0 });
  assert.deepEqual(s.push("1. 鼠\n2. "), []); assert.equal(s.deadline, 250);
  const text = "这是一个很长的解释，".repeat(12) + "括号（内部包含逗号，不应该从这里拆开）结束。";
  const parts = speechSegments(text, { policy });
  assert.equal(parts.join(""), text);
  assert.ok(parts.length > 1); assert.ok(parts.some(p => p.includes("（内部包含逗号，不应该从这里拆开）")));
});

test("trusted websocket output sends grouped text to actual TTS request construction exactly once", async (t) => {
  const { createReplyStreamRegistry } = await import("../../packages/core/voice/reply-stream.js");
  const { createAudioStreamGateway } = await import("../../packages/core/voice/stream-gateway.js");
  const { createDuplexCoordinator } = await import("../../packages/core/voice/duplex.js");
  const { createServer } = await import("node:http"); const { once } = await import("node:events"); const { WebSocket } = await import("ws");
  const bodies: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url: any, init: any) => {
    bodies.push(JSON.parse(init.body));
    return new Response(new Uint8Array(32), { headers: { "content-type": "audio/L16", "x-audio-sample-rate": "24000" } });
  });
  const registry = createReplyStreamRegistry({ inspect: async () => ({}), segmenterFactory: () => createSpeechSegmenter({ policy }) });
  const gateway = createAudioStreamGateway({ replies: registry, config: () => ({ speak: true, ttsModel: "tts" }), models: async () => [{ id: "tts", supportsTts: true }] });
  const server = createServer(); server.on("upgrade", (req, socket, head) => gateway.upgrade(req, socket, head));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const source = { sessionId: "grouped", turn: 1, step: 0 }; const attemptId = "grouped:a";
  registry.frame("grouped", { ...source, type: "start", attemptId, speechEligible: true });
  const scope: any = { id: "grouped-voice", active: true, readAloud: true, device: "device", duplex: createDuplexCoordinator() };
  let ws: InstanceType<typeof WebSocket> | undefined;
  try {
    const ticket = await gateway.ticket(scope, { operation: "tts", source, text: "spoofed" });
    ws = new WebSocket(`ws://127.0.0.1:${(server.address() as any).port}`, ["lares-voice", `lares-ticket.${ticket.ticket}`]);
    const finished = new Promise<void>((resolve, reject) => {
      ws!.on("error", reject); ws!.on("message", (raw, binary) => {
        if (binary) return; const e = JSON.parse(String(raw));
        if (e.type === "error") reject(new Error(e.code));
        if (e.type === "done") { ws!.close(); resolve(); }
      });
    });
    await once(ws, "open");
    const prefix = list.split("\n").slice(0, 3).join("\n") + "\n4. ";
    const frame = { type: "chunk", attemptId, index: 0, chunk: { type: "text-delta", text: prefix } };
    registry.frame("grouped", frame); registry.frame("grouped", frame);
    for (let i = 0; !bodies.length && i < 50; i++) await new Promise(r => setTimeout(r, 2));
    assert.equal(bodies[0]?.input, "鼠（子年）；牛（丑年）；虎（寅年）；");
    registry.event("grouped", { type: "assistant/message", data: { turn: 1, step: 0, message: { content: [{ type: "text", text: list }] } } });
    await finished;
    assert.deepEqual(bodies.map(b => b.input), speechSegments(list, { policy }));
  } finally { ws?.terminate(); registry.close(); gateway.close(); await new Promise<void>(r => server.close(() => r())); }
});

test("unclosed quotes remain provisional across paragraphs until final flush", () => {
  const s = createSpeechSegmenter({ policy });
  assert.deepEqual(s.push("已完成。还没闭合（内容\n\n下一段。"), ["已完成。"]);
  assert.deepEqual(s.finish(), ["还没闭合（内容", "下一段。"]);
});

test("a replaced generation cannot flush its pending list into the new attempt", async () => {
  const { createReplyStreamRegistry } = await import("../../packages/core/voice/reply-stream.js");
  const registry = createReplyStreamRegistry({ inspect: async () => ({}), segmenterFactory: () => createSpeechSegmenter({ policy }) });
  const source = { sessionId: "replace", turn: 1, step: 0 };
  const start = (attemptId: string) => registry.frame("replace", { ...source, type: "start", attemptId, speechEligible: true });
  try {
    start("old"); const old = (await registry.bind({}, source))(new AbortController().signal);
    const pending = old.next();
    registry.frame("replace", { type: "chunk", attemptId: "old", index: 0, chunk: { type: "text-delta", text: "1. 旧\n2. 等待" } });
    start("new"); await assert.rejects(pending, /voice_reply_replaced/);
    registry.frame("replace", { type: "chunk", attemptId: "old", index: 1, chunk: { type: "text-delta", text: "绝不续播" } });
    const current = (await registry.bind({}, source))(new AbortController().signal);
    const next = current.next();
    registry.frame("replace", { type: "chunk", attemptId: "new", index: 0, chunk: { type: "text-delta", text: "新回答。" } });
    assert.equal((await next).value.text, "新回答。"); await current.return();
  } finally { registry.close(); }
});
