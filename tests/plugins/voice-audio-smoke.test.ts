/**
 * Audio smoke gate. Run before an APK:
 *   npm run test:voice-smoke
 *
 * The phone's real panel, capture and lares-realtime client talk to the real
 * gateway. A scenario that stays on 转写中 for 3s fails. Search, file lookup,
 * interrupt, insert and the capture failures that used to stick are all here.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { WebSocket } from "ws";
import { createVoicePanel } from "@olares/lares-core/voice/panel";
import { voiceCallFailure, voicePanelPresentation } from "@olares/lares-core/voice/presentation";
import { createLaresRealtimeGateway } from "@olares/lares-core/voice/lares-realtime-gateway";
import { createUnifiedConversation } from "@olares/lares-core/voice/unified-conversation";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const SLOW = { timeout: 20_000 };

const nodes: { port: { onmessage: ((event: { data: { samples?: Float32Array; type?: string } }) => void) | null } }[] = [];

function installBrowser() {
  if ((globalThis as any).__voiceSmokeBrowser) return;
  (globalThis as any).__voiceSmokeBrowser = true;
  class AudioContext {
    sampleRate = 48000;
    state = "running";
    destination = {};
    audioWorklet = { addModule: async () => {} };
    resume = async () => {};
    close = async () => { this.state = "closed"; };
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { fftSize: 512, getFloatTimeDomainData(buf: Float32Array) { buf.fill(0); }, disconnect() {} }; }
    createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
    createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null }; }
  }
  class AudioWorkletNode {
    port: { onmessage: ((event: { data: { samples?: Float32Array; type?: string } }) => void) | null; postMessage: (msg: { type?: string }) => void };
    constructor() {
      this.port = {
        onmessage: null,
        postMessage: (msg) => {
          if (msg?.type === "flush") queueMicrotask(() => this.port.onmessage?.({ data: { type: "flushed" } }));
        },
      };
      nodes.push(this);
    }
    connect() {}
    disconnect() {}
  }
  (globalThis as any).AudioContext = AudioContext;
  (globalThis as any).webkitAudioContext = AudioContext;
  (globalThis as any).AudioWorkletNode = AudioWorkletNode;
  if (typeof URL.createObjectURL !== "function") {
    URL.createObjectURL = () => "blob:voice-smoke";
    URL.revokeObjectURL = () => {};
  }
}

async function feedMic() {
  const start = Date.now();
  while (Date.now() - start < 2000) {
    const node = nodes.at(-1);
    if (node?.port.onmessage) {
      const samples = new Float32Array(4800);
      samples.fill(0.2);
      node.port.onmessage({ data: { samples } });
      return;
    }
    await delay(10);
  }
  throw new Error("worklet not ready");
}

function replyFor(text: string) {
  if (/天气/.test(text)) return { tool: "search", speech: "明天北京有小雨" };
  if (/搜索/.test(text)) return { tool: "search", speech: "搜索到三条语音测试记录" };
  if (/文件|会议纪要|桌面/.test(text)) return { tool: "file", speech: "会议纪要在桌面，昨天改过" };
  if (/停|打断/.test(text)) return { tool: "interrupt", speech: "好，先停在这里" };
  if (/第一条|再看/.test(text)) return { tool: "follow", speech: "第一条是昨天下午的录音" };
  return { tool: "chat", speech: "好的" };
}

function readBody(req: any) {
  return new Promise<any>((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
  });
}

async function startPhone(options: { streamText?: string | null; holdPrompt?: boolean; holdSpeak?: boolean; stopFires?: boolean; earlyChunk?: boolean; blobSize?: number } = {}) {
  installBrowser();
  const prompts: string[] = [];
  const tools: string[] = [];
  const pcm: number[] = [];
  const uploads: number[] = [];
  const truncated: string[] = [];
  const errors: string[] = [];
  const tasks: { requestId: string; status: string }[] = [];
  const inserted: string[] = [];
  const audio = { bytes: 0, finished: 0, stopped: 0 };
  const controls = { heard: "", feed: true, stopFires: options.stopFires !== false, earlyChunk: options.earlyChunk === true, blobSize: options.blobSize ?? 4096 };
  let running = false;
  let holdPrompt = options.holdPrompt === true;
  let holdSpeak = options.holdSpeak === true;
  let shut = false;
  const waiters = new Set<() => void>();
  const release = () => { for (const resolve of waiters) resolve(); waiters.clear(); };
  const pause = () => shut ? Promise.resolve() : new Promise<void>((resolve) => { waiters.add(resolve); });
  const scope: any = {
    active: true,
    id: "smoke",
    device: "device",
    voiceConfig: { preset: "direct" },
    voiceOverrides: {},
    contextId: "ctx-1",
    session: { snapshot: () => ({ running, sessionId: "sess-1", tasks: tasks.map((task) => ({ ...task })) }) },
  };
  const service: any = {
    async open(target: any, body: any) {
      target.active = true;
      target.voiceConfig = { preset: body?.preset || "direct" };
      target.contextId = "ctx-1";
      target.session = scope.session;
    },
    async prompt(_target: any, body: any) {
      prompts.push(body.text);
      const reply = replyFor(body.text);
      tools.push(reply.tool);
      if (holdPrompt) { holdPrompt = false; await pause(); }
      running = true;
      tasks.push({ requestId: `${body.requestId}:tool`, status: "running" });
      await delay(20);
      tasks.at(-1)!.status = "completed";
      running = false;
      return { utterance: { key: body.requestId, text: reply.speech, silent: false } };
    },
    truncate(_target: any, _key: string, text: string) { truncated.push(text); },
    async clean(_target: any, text: string) { return text; },
    state: () => ({ running, utterance: null }),
    async cancel() { running = false; },
    async close(target: any) { target.active = false; },
    async withdraw() { return "withdrawn"; },
  };
  const gateway = createLaresRealtimeGateway({
    service,
    config: () => ({ idleTimeoutMs: 300_000 }),
    keys: { verify: () => null },
    transcribe: async (buf: Buffer) => {
      pcm.push(buf.length);
      if (options.streamText) throw new Error("batch should not run");
      return controls.heard;
    },
    synthesize: async (_sentence: string, _scope: any, onChunk?: (pcm: Buffer) => Promise<unknown>) => {
      const bytes = Buffer.alloc(9600);
      if (holdSpeak) {
        holdSpeak = false;
        await onChunk?.(bytes.subarray(0, 4800));
        await pause();
        return null;
      }
      return bytes;
    },
    openTranscription: () => ({ write() {}, async finish() { return options.streamText ?? null; }, cancel() {} }),
    segment: (text: string) => [text],
    onError: (cause: any) => { errors.push(cause?.code || cause?.message || "voice_failed"); },
  });
  const http = createServer(async (req, res) => {
    const body = await readBody(req);
    const url = req.url || "";
    const send = (status: number, payload: any) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); };
    try {
      if (req.method === "POST" && url === "/api/lares/voice/session") {
        await service.open(scope, body);
        return send(200, { running: false, active: true, sessionId: "sess-1" });
      }
      if (req.method === "POST" && url === "/api/lares/voice/realtime/ticket") return send(200, gateway.ticket(scope));
      if (req.method === "GET" && url === "/api/lares/voice/session") return send(200, { running, active: scope.active !== false, sessionId: "sess-1", error: null });
      if (req.method === "POST" && (url.endsWith("/session/close") || url.endsWith("/session/metric") || url.endsWith("/session/cancel"))) return send(200, {});
      if (req.method === "POST" && url.endsWith("/session/resume")) { scope.active = true; return send(200, { running, active: true, sessionId: "sess-1" }); }
      send(404, { error: { code: "missing" } });
    } catch (error: any) {
      send(error.status || 500, { error: { code: error.code || "voice_failed" } });
    }
  });
  http.on("upgrade", (req, socket, head) => gateway.upgrade(req, socket, head));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as any).port;
  const request = async (path: string, init: any = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: init.method || "GET",
      headers: { "content-type": "application/json", ...(init.headers || {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const payload = await res.json().catch(() => ({}));
    return { ok: res.ok, body: payload };
  };
  class Recorder {
    state = "inactive";
    mimeType = "audio/webm";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    static isTypeSupported() { return true; }
    start() {
      this.state = "recording";
      if (controls.earlyChunk) queueMicrotask(() => this.ondataavailable?.({ data: new Blob([new Uint8Array(controls.blobSize)]) }));
    }
    requestData() {}
    stop() {
      if (!controls.stopFires) return;
      this.state = "inactive";
      setTimeout(() => {
        this.ondataavailable?.({ data: new Blob([new Uint8Array(controls.blobSize)]) });
        this.onstop?.();
      }, 15);
    }
  }
  const media = { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {}, addEventListener() {} }] }) }, MediaRecorder: Recorder };
  const panel = createVoicePanel({
    loadConfig: async () => ({ speak: true, transport: "unified", device: "device", mobileMode: "continuous" }),
    process: async ({ text }: { text: string }) => text,
    complete: async ({ text }: { text: string }) => { inserted.push(text); },
    create: async ({ mode, onTranscript, config }: any) => {
      const continuous = mode === "continuous";
      return createUnifiedConversation({
        request,
        socket: (ticket: string) => new WebSocket(`ws://127.0.0.1:${port}/api/lares/voice/realtime`, ["lares-voice", `lares-ticket.${ticket}`]),
        device: "device",
        readAloud: continuous && config.speak === true,
        preset: continuous ? "direct" : "dictation",
        onTranscript: continuous ? null : onTranscript,
        media,
        transcribe: async (blob: Blob) => { uploads.push(blob.size); return controls.heard; },
        player: ({ onProgress }: { onProgress: (frames: number) => void }) => ({
          async start() {},
          write(bytes: Uint8Array) { audio.bytes += bytes.length; onProgress(audio.bytes / 2); },
          async finish() { audio.finished += 1; },
          stop() { audio.stopped += 1; release(); },
          pause() {},
          resume() {},
        }),
      });
    },
  });
  const view = () => panel.getSnapshot();
  const where = () => {
    const snap = view().snapshot;
    return `${snap?.connection || "-"}/${snap?.capture || "-"}/${snap?.playback || "-"}/${snap?.error || ""} phase=${voicePanelPresentation(view()).phase} prompts=${prompts.join("|")} errors=${errors.join("|")}`;
  };
  const until = async (pred: () => boolean | Promise<boolean>, label: string, ms = 8000) => {
    const start = Date.now();
    let stuck = 0;
    while (Date.now() - start < ms) {
      const capture = view().snapshot?.capture;
      if (capture === "transcribing") {
        if (!stuck) stuck = Date.now();
        if (Date.now() - stuck > 3000) throw new Error(`停在转写中 ${label}: ${where()}`);
      } else stuck = 0;
      if (await pred()) return;
      await delay(20);
    }
    throw new Error(`timeout ${label}: ${where()}`);
  };
  const recording = () => view().snapshot?.capture === "recording" && view().snapshot?.inputReady === true;
  const settled = () => {
    const snap = view().snapshot;
    const phase = voicePanelPresentation(view()).phase;
    return Boolean(snap) && snap!.capture === "idle" && snap!.playback === "idle" && phase !== "transcribing";
  };
  return {
    panel, prompts, tools, pcm, uploads, truncated, audio, controls, inserted, gateway, scope, port, where,
    async open(mode: "continuous" | "single" = "continuous") { await panel.open({ mode, sessionId: "sess-1" }); },
    async begin() {
      await panel.holdStart();
      await until(recording, "按住后开始录音");
    },
    async say(text: string, { waitMs = 750, feed = controls.feed }: { waitMs?: number; feed?: boolean } = {}) {
      controls.heard = text;
      if (view().snapshot?.capture !== "recording") await this.begin();
      if (feed) await feedMic();
      if (waitMs) await delay(waitMs);
      await panel.holdEnd(false);
    },
    async spoken(text: string) {
      const before = { prompts: prompts.length, finished: audio.finished, bytes: audio.bytes };
      await this.say(text);
      await until(() => prompts.length > before.prompts && audio.finished > before.finished && audio.bytes > before.bytes && settled() && voicePanelPresentation(view()).phase === "waiting", `说完「${text}」`);
    },
    until, settled, release, shutdown() { shut = true; release(); },
    async close() {
      shut = true; release();
      await panel.dispose().catch(() => {});
      gateway.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

test("an empty commit still ends the take", async () => {
  const phone = await startPhone();
  try {
    const { ticket } = phone.gateway.ticket(phone.scope);
    const ws = new WebSocket(`ws://127.0.0.1:${phone.port}/api/lares/voice/realtime`, ["lares-voice", `lares-ticket.${ticket}`]);
    const done = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("空提交没有结束转写")), 1000);
      ws.on("message", (raw) => {
        const event = JSON.parse(raw.toString());
        if (event.type !== "conversation.item.input_audio_transcription.completed") return;
        clearTimeout(timer);
        resolve(event);
      });
    });
    await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
    ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    const event = await done;
    assert.equal(event.transcript, "");
    assert.equal(phone.prompts.length, 0);
    ws.close();
  } finally { await phone.close(); }
}, SLOW);

test("search is transcribed, answered out loud, and the mic is free again", async () => {
  const phone = await startPhone();
  try {
    await phone.open();
    await phone.spoken("帮我搜索仓库里的语音测试");
    assert.deepEqual(phone.tools, ["search"]);
    assert.equal(phone.audio.bytes, 9600);
    assert.equal(phone.pcm.length, 1);
    assert.equal(phone.uploads.length, 0);
    assert.equal(voicePanelPresentation(phone.panel.getSnapshot()).phase, "waiting");
  } finally { await phone.close(); }
}, SLOW);

test("a file lookup is spoken and does not stay on transcribing", async () => {
  const phone = await startPhone();
  try {
    await phone.open();
    await phone.spoken("查一下桌面上的会议纪要");
    assert.deepEqual(phone.tools, ["file"]);
    assert.equal(phone.audio.finished, 1);
    assert.notEqual(voicePanelPresentation(phone.panel.getSnapshot()).phase, "transcribing");
  } finally { await phone.close(); }
}, SLOW);

test("interrupting a readout accepts the next question", async () => {
  const phone = await startPhone({ holdSpeak: true });
  try {
    await phone.open();
    await phone.say("帮我搜索仓库里的语音测试");
    await phone.until(() => phone.audio.bytes > 0, "播报开始");
    await phone.begin();
    await phone.say("停下，改成查明天的天气", { waitMs: 750 });
    await phone.until(() => phone.prompts.includes("停下，改成查明天的天气") && phone.settled(), "打断后的新问题");
    assert.ok(phone.audio.stopped >= 1);
    assert.equal(phone.tools.at(-1), "search");
    assert.equal(phone.prompts.length, 2);
  } finally { await phone.close(); }
}, SLOW);

test("dictation inserts into the draft and does not start an agent task", async () => {
  const phone = await startPhone();
  try {
    await phone.open("single");
    await phone.until(() => phone.panel.getSnapshot().snapshot?.inputReady === true, "听写开始");
    phone.controls.heard = "把会议改到三点";
    await feedMic();
    await delay(750);
    await phone.panel.finish();
    await phone.until(() => phone.panel.getSnapshot().draft.includes("三点"), "听写进草稿");
    assert.equal(phone.prompts.length, 0);
    await phone.panel.complete();
    assert.deepEqual(phone.inserted, ["把会议改到三点"]);
    assert.notEqual(voicePanelPresentation(phone.panel.getSnapshot()).phase, "transcribing");
  } finally { await phone.close(); }
}, SLOW);

test("a recorder that never stops still leaves transcribing", async () => {
  const phone = await startPhone({ stopFires: false, earlyChunk: true });
  try {
    await phone.open();
    phone.controls.feed = false;
    await phone.say("查一下桌面上的会议纪要", { feed: false, waitMs: 750 });
    await phone.until(() => phone.prompts.includes("查一下桌面上的会议纪要") && phone.settled(), "录音器不结束", 5000);
    assert.ok(phone.uploads.length >= 1);
    assert.equal(phone.tools[0], "file");
  } finally { await phone.close(); }
}, SLOW);

test("audio that missed the realtime socket is still submitted from the recording", async () => {
  const phone = await startPhone({ earlyChunk: true });
  try {
    await phone.open();
    phone.controls.feed = false;
    await phone.say("帮我搜索仓库里的语音测试", { feed: false });
    await phone.until(() => phone.prompts.includes("帮我搜索仓库里的语音测试") && phone.settled(), "录音回退");
    assert.ok(phone.uploads.length >= 1);
    assert.equal(phone.pcm.length, 0);
    assert.equal(phone.prompts.length, 1);
  } finally { await phone.close(); }
}, SLOW);

test("a streaming transcript is the turn and is not sent twice", async () => {
  const phone = await startPhone({ streamText: "帮我搜索仓库里的语音测试" });
  try {
    await phone.open();
    await phone.spoken("帮我搜索仓库里的语音测试");
    assert.equal(phone.pcm.length, 0);
    assert.equal(phone.prompts.length, 1);
    assert.equal(phone.uploads.length, 0);
  } finally { await phone.close(); }
}, SLOW);

test("silence does not stick, and the next question still runs", async () => {
  const phone = await startPhone();
  try {
    await phone.open();
    phone.controls.feed = false;
    await phone.say("", { feed: false });
    await phone.until(() => phone.panel.getSnapshot().snapshot?.capture === "idle", "没说话");
    const missed = phone.panel.getSnapshot();
    assert.equal(missed.snapshot?.connection, "open");
    assert.equal(missed.snapshot?.error, null);
    assert.equal(voiceCallFailure(missed), null);
    assert.equal(phone.prompts.length, 0);
    assert.notEqual(voicePanelPresentation(missed).phase, "transcribing");
    phone.controls.feed = true;
    await phone.spoken("查一下桌面上的会议纪要");
    assert.deepEqual(phone.tools, ["file"]);
  } finally { await phone.close(); }
}, SLOW);

test("a tap that is too short does not stick, and the next question still runs", async () => {
  const phone = await startPhone();
  try {
    await phone.open();
    await phone.say("帮我搜索仓库里的语音测试", { waitMs: 0, feed: false });
    await phone.until(() => {
      const snap = phone.panel.getSnapshot().snapshot;
      return snap?.capture === "idle" && snap.connection === "open" && !snap.error;
    }, "太短");
    assert.equal(voiceCallFailure(phone.panel.getSnapshot()), null);
    assert.equal(phone.prompts.length, 0);
    assert.notEqual(voicePanelPresentation(phone.panel.getSnapshot()).phase, "transcribing");
    await phone.spoken("帮我搜索仓库里的语音测试");
    assert.equal(phone.tools.at(-1), "search");
  } finally { await phone.close(); }
}, SLOW);

test("sliding away cancels the take, then a real question still runs", async () => {
  const phone = await startPhone();
  try {
    await phone.open();
    await phone.begin();
    await feedMic();
    await delay(750);
    await phone.panel.holdEnd(true);
    await phone.until(() => phone.panel.getSnapshot().snapshot?.capture === "idle", "取消");
    assert.equal(phone.prompts.length, 0);
    await phone.spoken("查一下桌面上的会议纪要");
    assert.deepEqual(phone.tools, ["file"]);
  } finally { await phone.close(); }
}, SLOW);

test("talking while the agent is busy does not stay on transcribing", async () => {
  const phone = await startPhone({ holdPrompt: true });
  try {
    await phone.open();
    await phone.say("帮我搜索仓库里的语音测试");
    await phone.until(() => phone.prompts.length === 1 && phone.panel.getSnapshot().snapshot?.capture === "idle", "第一句已提交");
    await phone.say("明天天气怎么样");
    await phone.until(() => phone.panel.getSnapshot().snapshot?.capture === "idle" && voicePanelPresentation(phone.panel.getSnapshot()).phase !== "transcribing", "忙碌时插话");
    phone.release();
    await phone.until(() => phone.audio.finished >= 1 && phone.settled(), "第一句播完");
    await phone.spoken("查一下桌面上的会议纪要");
    assert.equal(phone.tools.at(-1), "file");
  } finally { await phone.close(); }
}, SLOW);

test("a follow-up in the same call is answered after the first readout", async () => {
  const phone = await startPhone();
  try {
    await phone.open();
    await phone.spoken("帮我搜索仓库里的语音测试");
    await phone.spoken("再看第一条");
    assert.deepEqual(phone.tools, ["search", "follow"]);
    assert.equal(phone.audio.bytes, 19200);
    assert.equal(phone.prompts.length, 2);
    assert.equal(voicePanelPresentation(phone.panel.getSnapshot()).phase, "waiting");
  } finally { await phone.close(); }
}, SLOW);
