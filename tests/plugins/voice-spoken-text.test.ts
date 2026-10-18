import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { speechSegments, speechScript } from "@olares/lares-core/voice/script";
import { speakFromConfig } from "@olares/lares-core/voice/service";
import { createAudioStreamGateway } from "@olares/lares-core/voice/stream-gateway";
import { createDuplexCoordinator } from "@olares/lares-core/voice/duplex";
import { synthesizeStream } from "@olares/lares-core/router/tts";
import { playAudioStream } from "@olares/lares-core/voice/stream-client";

const animals = ["鼠 🐭", "牛 🐮", "虎 🐯", "兔 🐰", "龙 🐉", "蛇 🐍", "马 🐴", "羊 🐑", "猴 🐵", "鸡 🐔", "狗 🐕", "猪 🐖"];
const zodiac = "中国的十二生肖是：\n" + animals.map((animal, index) => `${index + 1}. **${animal}**`).join("\n");

test("zodiac speech removes emoji and formatting without rewriting the answer", () => {
  assert.deepEqual(speechSegments(zodiac), ["中国的十二生肖是：", ...animals.map(animal => animal.split(" ")[0])]);
  assert.ok(zodiac.includes("**鼠 🐭**"));
});

test("complete emoji sequences are removed while keycap digits and textual symbols survive", () => {
  assert.equal(speechScript("hello👩🏽‍💻world 🇨🇳 👨‍👩‍👧‍👦 👍🏿 🏳️‍🌈 1️⃣ 9⃣ © ® ™"), "hello world 1 9 © ® ™");
  assert.deepEqual(speechSegments("🐭\n👩🏽‍💻\n***"), []);
});

test("Markdown syntax is removed without erasing meaningful symbols", () => {
  const source = "## 标题 ##\n> **上午**：开会\n- [x] *下午*写代码\n1. ~~原文~~\n3.14; 5 * 3; a > b; snake_case; a_b_c; C#\n>= 3\n\\*literal\\*";
  assert.deepEqual(speechSegments(source), ["标题", "上午：开会", "下午写代码", "原文", "3.14; 5 * 3; a > b; snake_case; a_b_c; C#", ">= 3", "*literal*"]);
  assert.equal(speechScript("[说明](https://example.com/a_(b)) 与 ![示意图](image.png)"), "说明 与 示意图");
  assert.equal(speechScript("[说明][doc] 与 ![示意图][image]\n\n[doc]: https://example.com\n[image]: image.png"), "说明 与 示意图");
  assert.equal(speechScript("`a_b > 3` &amp; © https://example.com/path_name"), "a_b > 3 & © https://example.com/path_name");
  assert.equal(speechScript("| 项目 | 内容 |\n| --- | :---: |\n| 文件 | `a|b` 与 a\\|b |"), "项目 内容\n文件 a|b 与 a|b");
  assert.equal(speechScript("项目 | 内容\n--- | ---\n文件 | 正文"), "项目 内容\n文件 正文");
  assert.equal(speechScript("a | b"), "a | b");
  assert.equal(speechScript("前文\n~~~js\n不要朗读\n~~~\n后文"), "前文\n后文");
  assert.equal(speechScript("前文\n```js\n未关闭代码"), "前文");
});

const streamingFixtures = [
  zodiac,
  "First. **Bold. Still bold.** Next sentence. Last.",
  "First. _Emphasis. Across\nlines._ Next sentence. Last.",
  "First. [Label. More](https://example.com/path) Next sentence. Last.",
  "First. [Label. More][doc] Next sentence. Last.\n\n[doc]: https://example.com\n",
  "First. ![Useful. Image](image.png) Next sentence. Last.",
  "First. ![](image.png) Next sentence. Last.",
  "First. `code. more` Next sentence. Last.",
  "First. ~~old. words~~ Next sentence. Last.",
  "First. &amp; Next sentence. Last.",
  "First. &#x1F42D; Next sentence. Last.",
  "First. <think>Never speak.</think> Next sentence. Last.",
  "First. 👩🏽‍💻 Next sentence. 🇨🇳 Last.",
  "First. 1️⃣ Next sentence. Last.",
  "First. ```js\nsecret.\n``` Next sentence. Last.",
  "<think>Never speak.\nReasoning.</think>First. Next sentence. Last.",
  "# 标题\n| 项目 | 内容 |\n| --- | --- |\n| 名称 | 正文 |\n结尾。",
  "项目 | 内容\n--- | ---\n文件 | 正文\n结束。",
];

test("every streamed prefix is a stable prefix of final speech, including split UTF-16 sequences", () => {
  for (const source of streamingFixtures) {
    const final = speechSegments(source);
    let emitted: string[] = [];
    for (let offset = 0; offset <= source.length; offset++) {
      const partial = speechSegments(source.slice(0, offset), { done: false });
      assert.deepEqual(partial, final.slice(0, partial.length), `unstable final prefix at ${offset}: ${source.slice(0, offset)}`);
      assert.deepEqual(partial.slice(0, emitted.length), emitted, `rewritten emitted text at ${offset}: ${source.slice(0, offset)}`);
      emitted = partial;
      assert.deepEqual(speechSegments(source.slice(0, offset), { done: false }), partial);
    }
    assert.deepEqual(final.slice(0, emitted.length), emitted);
  }
});

test("unfinished syntax is held and final literal text is flushed without state crossing calls", () => {
  assert.deepEqual(speechSegments("**Not ready. More", { done: false }), []);
  assert.deepEqual(speechSegments("[Not ready. More", { done: false }), []);
  assert.deepEqual(speechSegments("Next reply."), ["Next reply."]);
  assert.deepEqual(speechSegments("[literal text"), ["[literal text"]);
});

test("the shared browser fallback completes empty speech without creating a player", async () => {
  const paths: string[] = [];
  const result = await playAudioStream({ text: "🐭", request: async (path: string) => {
    paths.push(path);
    return { ok: true, body: path.endsWith("/ticket") ? { supported: false } : { sentences: 0 } };
  } });
  assert.equal(result, true);
  assert.deepEqual(paths, ["/api/lares/voice/stream/ticket", "/api/lares/voice/speak"]);
});

test("buffered and websocket Lares speech clean the actual outgoing HTTP body; raw TTS does not", async (t) => {
  const bodies: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url: any, init: any) => {
    bodies.push(JSON.parse(init.body));
    return new Response(new Uint8Array([0, 0]), { headers: { "content-type": "audio/L16", "x-audio-sample-rate": "24000" } });
  });
  const config = { speak: true, ttsModel: "tts", ttsVoiceByModel: {} };
  await speakFromConfig(zodiac, { config, model: "tts", coordinator: createDuplexCoordinator(),
    openPlayback: async () => ({ skipped: true }), pcmToWav: (pcm: Buffer) => pcm });
  const expected = speechSegments(zodiac);
  assert.deepEqual(bodies.map(body => body.input), expected);
  bodies.length = 0;
  const gateway = createAudioStreamGateway({ config: () => config, models: async () => [{ id: "tts", supportsTts: true }] });
  const server = createServer();
  server.on("upgrade", (req, socket, head) => gateway.upgrade(req, socket, head));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const scope: any = { id: "speech-clean", device: "device", active: false, duplex: createDuplexCoordinator() };
    const consume = async (text: string) => {
      const grant = await gateway.ticket(scope, { operation: "tts", text });
      const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as any).port}`, ["lares-voice", `lares-ticket.${grant.ticket}`]);
      await new Promise<void>((resolve, reject) => {
        ws.on("error", reject);
        ws.on("message", (raw, binary) => {
          if (binary) return;
          const frame = JSON.parse(String(raw));
          if (frame.type === "error") { ws.close(); reject(new Error(frame.code)); }
          if (frame.type === "done") { ws.close(); resolve(); }
        });
      });
      await once(ws, "close");
    };
    await consume(zodiac);
    assert.deepEqual(bodies.map(body => body.input), expected);
    bodies.length = 0;
    await consume("👩🏽‍💻");
    assert.equal(bodies.length, 0);
    assert.deepEqual(await speakFromConfig("👩🏽‍💻", { config, model: "tts" }), { sentences: 0 });
    assert.equal(bodies.length, 0);
    await synthesizeStream({ text: "**原文** 🐭", model: "tts" }, () => {});
    assert.equal(bodies[0].input, "**原文** 🐭");
  } finally {
    gateway.close(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
