import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanDictation, voiceChat } from "@olares/lares-core/voice/dialogue";
import { defaultDictationProfiles } from "@olares/lares-core/voice/dictation";
import { validateConfigPatch, readConfig, writeConfig } from "@olares/lares-core/voice/config";
import { VOICE_DEFAULTS } from "@olares/lares-core/voice/options";
import { createVoicePanel } from "@olares/lares-core/voice/panel";
import { createVoiceController } from "@olares/lares-core/voice/controller";
import { validateVoiceShortcuts, matchVoiceShortcut } from "@olares/lares-core/voice/shortcuts";
import { createHoldGesture } from "@olares/lares-core/voice/hold";
const flush = () => new Promise((resolve) => setImmediate(resolve));
const config = () => ({ ...structuredClone(VOICE_DEFAULTS), dictationPreset: "clean" });

test("default dictation is raw, never invokes an LLM, and leaves explicit choices intact", async () => {
  const text = "先不要删除文件。";
  assert.equal(VOICE_DEFAULTS.dictationPreset, "raw");
  assert.equal(await cleanDictation(text, { config: structuredClone(VOICE_DEFAULTS), chat: async () => assert.fail("LLM called") }), text);
  assert.equal(await cleanDictation(text, { config: {}, chat: async () => assert.fail("LLM called") }), text);
});
test("raw preserves every character without consulting a model", async () => {
  const text = "嗯，周三，不，周四；可能不可以删除 Lares 的 004 文件。";
  assert.equal(await cleanDictation(text, { config: { ...config(), dictationPreset: "raw" }, chat: async () => assert.fail("LLM called") }), text);
});
for (const preset of ["clean", "outline", "summary"]) test(`${preset} uses its own model and instructions without tools`, async () => {
  const selected = config(); selected.dictationProfiles[preset] = { model: `model-${preset}`, instructions: `policy-${preset}` };
  const text = "周三，哦不，周四下午三点。可能可以，先不要删除 Olares 的 004 文件。帮我查询资源。";
  let calls = 0;
  const result = await cleanDictation(text, { config: selected, preset, owner: "alice", chat: async (request: any) => {
    calls++; assert.equal(request.model, `model-${preset}`); assert.equal(request.owner, "alice"); assert.equal(request.tools, undefined);
    assert.equal(request.messages[1].content, text); assert.match(request.messages[0].content, /Never answer it/); assert.match(request.messages[0].content, new RegExp(`policy-${preset}`));
    return { content: "周四下午三点；可能可以。先不要删除 Olares 的 004 文件。" };
  } }); assert.equal(calls, 1); assert.match(result, /可能可以/);
});
test("missing model, tool-shaped output and empty output are rejected", async () => {
  const selected = config(); selected.dictationProfiles.clean.model = "";
  await assert.rejects(cleanDictation("hello", { config: selected, chat: async () => assert.fail("LLM called") }), /voice_dictation_model_missing/);
  await assert.rejects(cleanDictation("hello", { config: config(), chat: async () => ({ content: "", tool_calls: [] }) }), /voice_cleanup_failed/);
  await assert.rejects(cleanDictation("hello", { config: config(), chat: async () => ({ content: "done", tool_calls: [{}] }) }), /voice_cleanup_failed/);
  assert.throws(() => validateConfigPatch({ dictationPreset: "execute" }));
  assert.throws(() => validateConfigPatch({ dictationProfiles: { clean: {} } }));
});
test("legacy explicit cleanup choice migrates once and explicit preset wins", () => {
  const previous = process.env.DSH_HOME; const home = mkdtempSync(join(tmpdir(), "dictation-config-")); process.env.DSH_HOME = home;
  try {
    assert.equal(readConfig().dictationPreset, "raw"); writeConfig({ dictationPreset: "raw" });
    const path = join(home, "voice-input", "config.json");
    writeFileSync(path, JSON.stringify({ dictationCleanup: false })); assert.equal(readConfig().dictationPreset, "raw");
    writeFileSync(path, JSON.stringify({ dictationCleanup: true })); assert.equal(readConfig().dictationPreset, "clean");
    writeFileSync(path, JSON.stringify({ dictationCleanup: false, dictationPreset: "outline" })); assert.equal(readConfig().dictationPreset, "outline");
    writeConfig({ dictationPreset: "summary" }); assert.equal(JSON.parse(readFileSync(path, "utf8")).dictationCleanup, undefined);
  } finally { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous; rmSync(home, { recursive: true, force: true }); }
});
function harness(options: any = {}) {
  const calls: any[] = [], inserted: any[] = [], processed: any[] = [];
  const panel = createVoicePanel({ loadConfig: async () => config(), complete: async (value: any) => inserted.push(value),
    process: async (value: any) => { processed.push(value); return `processed:${value.text}`; },
    create: async (ports: any) => {
      let finish: any; const controller = createVoiceController({ onTranscript: ports.mode === "single" ? ports.onTranscript : null,
        input: { capture: ({ onReady }: any) => { onReady?.(); return new Promise((resolve) => { finish = resolve; }); }, stop: () => finish?.("raw words"), cancel: () => finish?.("") },
        output: { stop: () => {} }, agent: { create: async () => "s", submit: async () => {}, running: async () => false, cancel: () => assert.fail("task cancelled") } });
      const call = { controller, start: (value: any) => controller.start(value), stop: () => controller.disconnect(), pause: () => controller.pause(), resume: (value: any) => controller.resume(value) }; calls.push(call); return call;
    }, ...options }); return { panel, calls, inserted, processed };
}
test("dictation starts once, finishes into editable preview and inserts only on confirmation", async () => {
  const h = harness(); await h.panel.open({ sessionId: "s" }); assert.equal(h.calls.length, 1);
  await h.panel.finish(); assert.equal(h.inserted.length, 0); assert.equal(h.panel.getSnapshot().draft, "processed:raw words");
  h.panel.edit("manual text"); assert.equal(await h.panel.selectPreset("summary"), false);
  await h.panel.selectPreset("raw", true); assert.equal(h.panel.getSnapshot().draft, "raw words");
  h.panel.edit("edited final"); await h.panel.complete(); assert.deepEqual(h.inserted, [{ sessionId: "s", text: "edited final" }]); await h.panel.dispose();
});
test("failed cleanup retains original and can recover without recording again", async () => {
  const h = harness({ process: async () => { throw new Error("offline"); } }); await h.panel.open(); await h.panel.finish();
  assert.equal(h.panel.getSnapshot().raw, "raw words"); assert.equal(h.panel.getSnapshot().draft, "raw words"); assert.equal(h.panel.getSnapshot().error, "offline");
  await h.panel.selectPreset("raw", true); assert.equal(h.panel.getSnapshot().error, null); await h.panel.dispose();
});
test("using raw interrupts stalled cleanup and inserts once without waiting for its result", async () => {
  let resolve: any; let signal: AbortSignal;
  const h = harness({ inlineDictation: true, process: (request: any) => { signal = request.signal; return new Promise(done => { resolve = done; }); } });
  await h.panel.open({ sessionId: "s" }); const finishing = h.panel.finish(); await flush();
  assert.equal(h.panel.getSnapshot().stage, "processing");
  assert.equal(h.panel.getSnapshot().raw, "raw words");
  const original = h.panel.selectPreset("raw", true); await flush();
  assert.equal(signal!.aborted, true);
  await Promise.all([finishing, original]); await h.panel.complete();
  assert.deepEqual(h.inserted, [{ sessionId: "s", text: "raw words" }]);
  resolve("late cleanup"); await flush(); assert.equal(h.inserted.length, 1);
  assert.equal(h.panel.getSnapshot().busy, false); await h.panel.dispose();
});
test("cleanup deadline exits loading with original intact even when the request ignores abort", async (t) => {
  const deadline = new AbortController();
  const h = harness({ inlineDictation: true, process: () => new Promise(() => {}) });
  await h.panel.open();
  t.mock.method(AbortSignal, "timeout", () => deadline.signal);
  const finishing = h.panel.finish(); await flush();
  deadline.abort(new DOMException("Timed out", "TimeoutError")); await finishing;
  assert.equal(h.panel.getSnapshot().stage, "preview"); assert.equal(h.panel.getSnapshot().busy, false);
  assert.equal(h.panel.getSnapshot().raw, "raw words"); assert.equal(h.panel.getSnapshot().draft, "raw words");
  assert.ok(h.panel.getSnapshot().error); assert.equal(h.inserted.length, 0); await h.panel.dispose();
});
test("late processing cannot overwrite manual edits or a newly selected session", async () => {
  let resolve: any; const h = harness({ process: () => new Promise((done) => { resolve = done; }) });
  await h.panel.open({ sessionId: "old" }); const finishing = h.panel.finish(); await flush();
  h.panel.edit("manual"); resolve("late"); await finishing; assert.equal(h.panel.getSnapshot().draft, "manual");
  const next = h.panel.selectPreset("summary", true); await flush(); const bind = h.panel.bind("new"); resolve("stale"); await next; await bind;
  assert.equal(h.panel.getSnapshot().draft, ""); await h.panel.bind("old"); assert.equal(h.panel.getSnapshot().draft, "manual"); await h.panel.dispose();
});
test("closing while creation is pending never opens the microphone", async () => {
  let resolve: any, starts = 0, stops = 0;
  const h = harness({ create: () => new Promise((done) => { resolve = done; }) });
  const opening = h.panel.open(); await flush(); const closing = h.panel.close();
  resolve({ start: async () => { starts++; }, stop: async () => { stops++; } }); await opening; await closing;
  assert.equal(starts, 0); assert.equal(stops, 1); await h.panel.dispose();
});
test("holding after the call has ended opens readout and listens again", async () => {
  const h = harness({ loadConfig: async () => ({ ...config(), speak: true }) });
  await h.panel.open({ mode: "continuous" });
  await h.panel.holdStart();
  await h.calls[0].controller.disconnect();
  await h.panel.holdEnd();
  await h.panel.holdStart();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].controller.getSnapshot().connection, "open");
  assert.equal(h.calls[1].controller.getSnapshot().capture, "recording");
  assert.equal(h.panel.getSnapshot().visible, true);
  await h.panel.dispose();
});
test("text send reopens readout without the voice control or the microphone", async () => {
  const h = harness({ manualTurns: false, loadConfig: async () => ({ ...config(), speak: true }) });
  await h.panel.open({ mode: "continuous" });
  await h.panel.start();
  assert.equal(h.calls[0].controller.getSnapshot().capture, "recording");
  await h.panel.close();
  assert.equal(h.panel.getSnapshot().visible, false);
  assert.equal(h.calls[0].controller.getSnapshot().connection, "paused");
  await h.panel.openReadout();
  assert.equal(h.calls.length, 1);
  assert.equal(h.panel.getSnapshot().visible, false);
  assert.equal(h.calls[0].controller.getSnapshot().connection, "open");
  assert.equal(h.calls[0].controller.getSnapshot().capture, "idle");
  await h.calls[0].controller.disconnect();
  await h.panel.openReadout();
  assert.equal(h.calls.length, 2);
  assert.equal(h.panel.getSnapshot().visible, false);
  assert.equal(h.calls[1].controller.getSnapshot().connection, "open");
  assert.equal(h.calls[1].controller.getSnapshot().capture, "idle");
  await h.panel.dispose();
});
test("text send does not open a readout session while speech is off", async () => {
  const h = harness();
  await h.panel.open({ mode: "continuous" });
  await h.panel.start();
  await h.calls[0].controller.disconnect();
  await h.panel.close();
  await h.panel.openReadout();
  assert.equal(h.calls.length, 1);
  assert.equal(h.panel.getSnapshot().visible, false);
  await h.panel.dispose();
});
test("conversation waits for a hold; release submits once and never automatically listens again", async () => {
  const h = harness(); await h.panel.open({ mode: "continuous" }); assert.equal(h.calls.length, 0);
  await h.panel.holdStart(); assert.equal(h.panel.getSnapshot().snapshot.capture, "recording"); await h.panel.holdEnd(); await flush();
  const controller = h.calls[0].controller; controller.observeAgent(false); controller.observePlayback(false); await flush();
  assert.equal(controller.getSnapshot().capture, "idle"); assert.equal(h.calls.length, 1);
  await h.panel.holdStart(); await h.panel.holdEnd(true); await flush(); assert.equal(controller.getSnapshot().capture, "idle"); await h.panel.dispose();
});
test("release during preparation invalidates the pending hold", async () => {
  let resolve: any, starts = 0;
  const h = harness({ loadConfig: () => new Promise((done) => { resolve = done; }), create: async () => { starts++; assert.fail("microphone opened"); } });
  await h.panel.open({ mode: "continuous" }); const holding = h.panel.holdStart(); await flush(); await h.panel.holdEnd(); resolve(config()); await holding;
  assert.equal(starts, 0); await h.panel.dispose();
});
test("shortcuts reject duplicates and common browser conflicts and ignore repeats", () => {
  const shortcuts = { ...config().dictationShortcuts, clean: "Ctrl+Shift+1" };
  assert.deepEqual(validateVoiceShortcuts(shortcuts), shortcuts);
  assert.throws(() => validateVoiceShortcuts({ ...shortcuts, summary: "Ctrl+Shift+1" }));
  assert.throws(() => validateVoiceShortcuts({ ...shortcuts, raw: "Meta+w" }));
  const event = { key: "1", ctrlKey: true, shiftKey: true };
  assert.equal(matchVoiceShortcut(event, shortcuts), "clean"); assert.equal(matchVoiceShortcut({ ...event, repeat: true }, shortcuts), null);
});
test("hold gestures distinguish release, slide-up cancellation and lost pointer", () => {
  const values: any[] = []; const gesture = createHoldGesture({ start: () => values.push("start"), end: (cancel: boolean) => values.push(cancel) });
  const event = { pointerId: 1, button: 0, clientY: 150, preventDefault() {}, currentTarget: { setPointerCapture() {} } };
  gesture.pointerDown(event); gesture.pointerUp({ ...event, clientY: 40 }); gesture.cancel(); assert.deepEqual(values, ["start", true]);
  gesture.pointerDown(event); gesture.pointerUp(event); assert.deepEqual(values.slice(-2), ["start", false]);
});

test("close does not wait for a text processor that ignores cancellation", async () => {
  const h = harness({ process: () => new Promise(() => {}) }); await h.panel.open();
  const pending = h.panel.finish(); await flush(); await h.panel.close(); await pending;
  assert.equal(h.panel.getSnapshot().visible, false); assert.equal(h.panel.getSnapshot().stage, "preview");
  assert.equal(h.panel.getSnapshot().draft, "raw words"); await h.panel.dispose();
});
test("shifted physical shortcut keys match consistently and typing-only combinations are refused", () => {
  const shortcuts = { ...config().dictationShortcuts, outline: "Ctrl+Shift+1" };
  assert.equal(matchVoiceShortcut({ key: "!", code: "Digit1", ctrlKey: true, shiftKey: true }, shortcuts), "outline");
  assert.throws(() => validateVoiceShortcuts({ ...shortcuts, raw: "Shift+a" }));
  assert.throws(() => validateVoiceShortcuts({ ...shortcuts, raw: "Shift+Ctrl+a" }));
});

test("close during microphone permission preparation cancels instead of finishing a late recording", async () => {
  let say: any; let stops = 0, cancelled = 0;
  const h = harness({ create: async ({ onTranscript }: any) => {
    const controller = createVoiceController({ onTranscript,
      input: { capture: () => new Promise((resolve) => { say = resolve; }), stop: () => { stops++; }, cancel: () => { cancelled++; say?.("late"); } },
      agent: { create: async () => "s", running: async () => false }, output: { stop() {} } });
    return { controller, start: (args: any) => controller.start(args), stop: () => controller.disconnect(), pause: () => controller.pause() };
  } });
  await h.panel.open(); await h.panel.close(); await flush();
  assert.equal(stops, 0); assert.ok(cancelled); assert.equal(h.panel.getSnapshot().raw, ""); await h.panel.dispose();
});
test("resume guard prevents a late microphone start after the panel closes", async () => {
  let resolve: any, captures = 0;
  const controller = createVoiceController({ input: { capture: () => { captures++; return new Promise(() => {}); }, cancel() {} }, output: { stop() {} },
    agent: { running: () => new Promise((done) => { resolve = done; }) } });
  await controller.start({ sessionId: "s", continuous: true, manual: true }); await controller.pause();
  let allowed = true; const pending = controller.resume({ shouldResume: () => allowed }); allowed = false; resolve(false); await pending;
  assert.equal(captures, 0); assert.equal(controller.getSnapshot().connection, "paused"); await controller.disconnect();
});

test("cancel selection is live and uses hysteresis without duplicate announcements", () => {
  const selections: boolean[] = [], ends: boolean[] = [];
  const gesture = createHoldGesture({ start() {}, end: (cancel: boolean) => ends.push(cancel), onCancelChange: (value: boolean) => selections.push(value) });
  const event = { pointerId: 1, button: 0, clientY: 200, preventDefault() {}, currentTarget: { setPointerCapture() {} } };
  gesture.pointerDown(event);
  for (const clientY of [145, 140, 142, 145, 159]) gesture.pointerMove({ ...event, clientY });
  assert.deepEqual(selections, [true]);
  gesture.pointerMove({ ...event, clientY: 161 }); assert.deepEqual(selections, [true, false]);
  gesture.pointerUp({ ...event, clientY: 150 }); gesture.cancel({ pointerId: 1 });
  assert.deepEqual(ends, [false]);
});
test("multi-touch, pointer loss and keyboard repeat cannot double-submit", () => {
  const ends: boolean[] = []; let starts = 0;
  const gesture = createHoldGesture({ start: () => starts++, end: (cancel: boolean) => ends.push(cancel) });
  const event = { pointerId: 1, button: 0, clientY: 200, preventDefault() {}, currentTarget: { setPointerCapture() {} } };
  gesture.pointerDown(event); gesture.pointerDown({ ...event, pointerId: 2, isPrimary: false }); gesture.pointerUp(event);
  assert.deepEqual(ends, [true]);
  gesture.keyDown({ code: "Space", preventDefault() {} }); gesture.keyDown({ code: "Space", repeat: true, preventDefault() {} });
  assert.equal(gesture.escape(), true); assert.equal(gesture.escape(), false); gesture.keyUp({ code: "Space", preventDefault() {} });
  assert.deepEqual(ends, [true, true]); assert.equal(starts, 2);
  gesture.keyDown({ code: "Enter", preventDefault() {} }); gesture.keyDown({ code: "Enter", repeat: true, preventDefault() {} }); gesture.keyDown({ code: "Enter", preventDefault() {} });
  assert.deepEqual(ends, [true, true, false]); assert.equal(starts, 3);
});
test("armed cancellation reaches core and performs neither recognition finish nor task submission", async () => {
  const h = harness(); await h.panel.open({ mode: "continuous" }); await h.panel.holdStart();
  h.panel.setCancelArmed(true); assert.equal(h.panel.getSnapshot().cancelArmed, true);
  await h.panel.holdEnd(); await flush();
  assert.equal(h.panel.getSnapshot().cancelArmed, false); assert.equal(h.panel.getSnapshot().snapshot.agent, "idle");
  assert.equal(h.panel.getSnapshot().snapshot.capture, "idle"); await h.panel.dispose();
});

test("a second finger outside the hold button cancels its captured pointer", () => {
  const ends: boolean[] = [];
  const gesture = createHoldGesture({ start() {}, end: (cancel: boolean) => ends.push(cancel) });
  const event = { pointerId: 1, button: 0, clientY: 200, preventDefault() {}, currentTarget: { setPointerCapture() {} } };
  gesture.additionalPointer(event); gesture.pointerDown(event);
  gesture.additionalPointer({ pointerId: 2 }); gesture.pointerUp(event); gesture.cancel({ pointerId: 1 });
  assert.deepEqual(ends, [true]);
});

test("releasing in the cancel zone never finishes ASR, creates a session or submits an agent", async () => {
  let finish: any, recognized = 0, created = 0, submitted = 0;
  const panel = createVoicePanel({ complete: async () => {}, create: async () => {
    const controller = createVoiceController({ input: {
      capture: ({ onReady }: any) => { onReady(); return new Promise((resolve) => { finish = resolve; }); },
      stop: () => { recognized++; finish("must not submit"); }, cancel: () => finish?.("") },
      output: { stop() {} }, agent: { create: async () => { created++; return "new"; }, submit: async () => { submitted++; } } });
    return { controller, start: (args: any) => controller.start(args), stop: () => controller.disconnect() };
  } });
  await panel.open({ mode: "continuous" }); await panel.holdStart(); panel.setCancelArmed(true); await panel.holdEnd(); await flush();
  assert.deepEqual({ recognized, created, submitted }, { recognized: 0, created: 0, submitted: 0 }); await panel.dispose();
});

test("repeated Done while processing performs one text conversion", async () => {
  let converted = 0, release: any;
  const panel = createVoicePanel({ loadConfig: async () => ({ dictationPreset: "clean" }), complete: async () => {}, process: async () => { converted++; return new Promise(resolve => { release = resolve; }); }, create: async ({ onTranscript }: any) => {
    let say: any;
    const controller = createVoiceController({ onTranscript, input: { capture: ({ onReady }: any) => { onReady(); return new Promise(resolve => { say = resolve; }); }, stop: () => say("words"), cancel: () => say("") }, agent: {}, output: { stop() {} } });
    return { controller, start: (options: any) => controller.start(options), stop: () => controller.disconnect(), pause: () => controller.pause() };
  } });
  await panel.open({ sessionId: "s" }); const done = panel.finish();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await panel.finish(); assert.equal(converted, 1); release("clean words"); await done; await panel.dispose();
});


test("dictation uses Router output defaults while dialogue keeps its explicit budget", async () => {
  const calls: any[] = [];
  const chat = request => voiceChat({ ...request, fetch: async (_url, init) => {
    calls.push(JSON.parse(String(init.body)));
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: "先不要删除文件。" } }] });
  } });
  for (const preset of ["clean", "outline", "summary"]) {
    await cleanDictation("先不要删除文件。", { config: config(), preset, chat });
    assert.equal(Object.hasOwn(calls.at(-1), "max_tokens"), false);
    assert.equal(calls.at(-1).model, "default-chat");
    assert.equal(calls.at(-1).tools, undefined);
  }
  await chat({ messages: [] }); assert.equal(calls.at(-1).max_tokens, 1024);
  await chat({ messages: [], maxTokens: 256 }); assert.equal(calls.at(-1).max_tokens, 256);
  await assert.rejects(cleanDictation("先不要删除文件。", { config: config(), chat: request => voiceChat({ ...request,
    fetch: async () => Response.json({ choices: [{ finish_reason: "length", message: { content: "先删除" } }] }),
  }) }), /voice_chat_limit/);
});
