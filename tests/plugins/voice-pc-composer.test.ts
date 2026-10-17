import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { voiceAvailability, voicePrimaryAction, voiceDictationPresentation } from "@olares/lares-core/voice/presentation";
import { createVoicePanel } from "@olares/lares-core/voice/panel";
import { createVoiceController } from "@olares/lares-core/voice/controller";
import { SlotCore } from "@deepseek-ai/dsh-client-ui-slots";

const flush = () => new Promise(resolve => setImmediate(resolve));
const settings = { config: { model: "asr", ttsModel: "tts", chatModel: "default-chat", backend: "pipeline" }, sttModels: ["asr"], ttsModels: ["tts"], chatModels: ["llm"] };
test("only an active dictation take owns the whole composer, including preparation and recovery", () => {
  for (const stage of ["idle", "processing", "preview"]) assert.equal(voiceDictationPresentation({ visible: true, mode: "single", stage }).exclusive, true);
  assert.equal(voiceDictationPresentation({ visible: false, mode: "single", error: "voice_failed" }).exclusive, false);
  assert.equal(voiceDictationPresentation({ visible: true, mode: "continuous" }).exclusive, false);
});
test("dictation shows a waveform only while recording, never during processing or failure", () => {
  const view = { mode: "single", snapshot: { capture: "recording", inputReady: true } };
  assert.equal(voiceDictationPresentation(view).waveform, true);
  assert.equal(voiceDictationPresentation({ ...view, snapshot: { capture: "transcribing" } }).waveform, false);
  assert.equal(voiceDictationPresentation({ mode: "single", stage: "processing", busy: true }).waveform, false);
  assert.equal(voiceDictationPresentation({ ...view, error: "voice_failed" }).waveform, false);
});
test("cleanup failure preserves raw recovery and is distinguished from ASR or insertion failure", () => {
  const conversion = voiceDictationPresentation({ mode: "single", raw: "Thursday, do not delete files", error: "voice_cleanup_failed", snapshot: { connection: "closed", capture: "idle" } });
  assert.equal(conversion.processingFailed, true); assert.equal(conversion.recoverable, true); assert.equal(conversion.phase, "error");
  const recognition = voiceDictationPresentation({ mode: "single", error: "voice_failed" });
  assert.equal(recognition.processingFailed, false); assert.equal(recognition.recoverable, false);
  const insertion = voiceDictationPresentation({ mode: "single", raw: "raw", error: "voice_draft_changed" });
  assert.equal(insertion.processingFailed, false); assert.equal(insertion.recoverable, true);
});
test("PC primary registration satisfies the real dsh chain-slot contract", () => {
  const slots = new SlotCore();
  slots.register({ name: "root", children: { "conversation.input.primary": { kind: "chain", scope: "session" } } }, () => null);
  const source = readFileSync(new URL("../../packages/web/composer-voice/src/client/index.js", import.meta.url), "utf8");
  const options = source.match(/scope\.slots\.register\((\{ name: "conversation\.input\.primary".*?\}), props/);
  assert.ok(options);
  const entry = new Function(`return (${options[1]})`)();
  assert.doesNotThrow(() => slots.register(entry, () => null));
});
test("PC capability gates use discovered models, preserve raw dictation without LLM and gate Realtime", () => {
  assert.equal(voiceAvailability(null).conversation, false);
  assert.equal(voiceAvailability(settings).conversation, true);
  assert.equal(voiceAvailability({ ...settings, sttModels: [] }).dictation, false);
  assert.equal(voiceAvailability({ ...settings, ttsModels: [] }).conversation, false);
  assert.equal(voiceAvailability({ ...settings, chatModels: [] }).dictation, true);
  assert.equal(voiceAvailability({ ...settings, chatModels: [] }).conversation, false);
  assert.equal(voiceAvailability({ ...settings, config: { ...settings.config, chatModel: "missing" } }).conversation, false);
  assert.equal(voiceAvailability({ ...settings, config: { ...settings.config, backend: "realtime" }, realtimeReady: ["native"] }).conversation, false);
  assert.equal(voiceAvailability({ ...settings, status: { ok: false } }).conversation, true);
});
test("primary action keeps native send/stop and selects finish, pause and explicit resume", () => {
  const choose = (patch: any = {}) => voicePrimaryAction({ view: {}, empty: true, available: true, running: false, ...patch });
  assert.equal(choose().action, "conversation");
  assert.equal(choose({ empty: false, running: true }).action, "native");
  assert.equal(choose({ running: true }).action, "native");
  assert.deepEqual(choose({ available: false }), { action: "native", disabled: true });
  const active = { visible: true, mode: "continuous", snapshot: { connection: "open" } };
  assert.equal(choose({ view: active, running: true }).action, "pause");
  assert.equal(choose({ view: active, empty: false }).action, "native");
  assert.equal(choose({ view: { ...active, snapshot: { connection: "paused" } } }).action, "resume");
  assert.equal(choose({ view: { ...active, snapshot: { connection: "paused" } }, available: false }).action, "native");
  assert.deepEqual(choose({ view: { visible: true, mode: "continuous", busy: true } }), { action: "pause", disabled: false });
  assert.equal(choose({ view: { visible: true, mode: "single", busy: true }, empty: false }).disabled, true);
});

function harness(options: any = {}) {
  const inserted: any[] = [], calls: any[] = [], submitted: any[] = [];
  let say: any;
  const panel = createVoicePanel({ manualTurns: false, inlineDictation: true,
    loadConfig: async () => ({ dictationPreset: "raw" }), complete: async (value: any) => { inserted.push(value); },
    create: async (ports: any) => {
      const controller = createVoiceController({ onTranscript: ports.mode === "single" ? ports.onTranscript : null,
        input: { capabilities: { bargeIn: false }, capture: ({ onReady }: any) => { onReady(); return new Promise(resolve => { say = resolve; }); }, stop: () => say("speech"), cancel: () => say?.("") },
        agent: { create: async () => "business", running: async () => false, submit: async (value: any) => { submitted.push(value); }, cancel: () => assert.fail("must preserve task") }, output: { stop() {} } });
      const call = { controller, start: (args: any) => controller.start(args), pause: () => controller.pause(), resume: (args: any) => controller.resume(args), stop: () => controller.disconnect() };
      calls.push(call); return call;
    }, ...options });
  return { panel, calls, submitted, inserted, say: (text: string) => say(text) };
}
test("PC raw dictation appends once without preview or LLM", async () => {
  const h = harness({ process: () => assert.fail("raw must skip LLM") });
  await h.panel.open({ sessionId: "original" }); await Promise.all([h.panel.finish(), h.panel.finish()]);
  assert.deepEqual(h.inserted, [{ sessionId: "original", text: "speech" }]);
  assert.equal(h.panel.getSnapshot().previewVisible, false); assert.equal(h.panel.getSnapshot().visible, false);
  assert.equal(h.submitted.length, 0); await h.panel.dispose();
});
test("PC cleanup failure retains original and permits explicit raw recovery", async () => {
  const h = harness({ loadConfig: async () => ({ dictationPreset: "clean" }), process: async () => { throw new Error("offline"); } });
  await h.panel.open(); await h.panel.finish();
  assert.equal(h.inserted.length, 0); assert.equal(h.panel.getSnapshot().raw, "speech"); assert.equal(h.panel.getSnapshot().previewVisible, false);
  await h.panel.selectPreset("raw", true); await h.panel.complete(); assert.equal(h.inserted[0].text, "speech"); await h.panel.dispose();
});
test("discard interrupts recognition immediately, with no delayed insertion or task", async () => {
  const h = harness(); await h.panel.open();
  h.calls[0].controller.stopRecording = () => {};
  const finish = h.panel.finish(); await flush();
  await h.panel.discard(); await finish;
  assert.equal(h.inserted.length, 0); assert.equal(h.submitted.length, 0); assert.equal(h.panel.getSnapshot().raw, ""); await h.panel.dispose();
});
test("closing during conversion prevents automatic insertion and retains the original session draft", async () => {
  let release: any;
  const h = harness({ loadConfig: async () => ({ dictationPreset: "clean" }), process: () => new Promise(resolve => { release = resolve; }) });
  await h.panel.open({ sessionId: "old" }); const finish = h.panel.finish(); await flush();
  const closing = h.panel.close(); release("late"); await finish; await closing;
  assert.equal(h.inserted.length, 0); assert.equal(h.panel.getSnapshot().raw, "speech");
  await h.panel.bind("new"); assert.equal(h.panel.getSnapshot().raw, "");
  await h.panel.bind("old"); assert.equal(h.panel.getSnapshot().raw, "speech"); await h.panel.dispose();
});
test("PC automatic rounds resume after playback; pause keeps tasks and requires explicit start", async () => {
  const h = harness(); await h.panel.open({ mode: "continuous", sessionId: "business" }); await h.panel.start();
  assert.equal(h.calls[0].controller.getSnapshot().capture, "recording");
  h.say("hello"); await flush(); assert.equal(h.submitted.length, 1);
  const controller = h.calls[0].controller;
  controller.observeAgent(false, true); controller.observePlayback(true); await flush();
  assert.equal(controller.getSnapshot().capture, "idle");
  controller.observePlayback(false); assert.equal(controller.getSnapshot().capture, "recording");
  await h.panel.pause(); controller.observePlayback(false); await flush();
  assert.equal(controller.getSnapshot().capture, "idle"); assert.equal(controller.getSnapshot().connection, "paused");
  await h.panel.start(); assert.equal(h.calls.length, 1); assert.equal(controller.getSnapshot().capture, "recording"); await h.panel.dispose();
});

function submissionHarness() {
  const source = readFileSync(new URL("../../node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js", import.meta.url), "utf8");
  const start = source.indexOf("beforeSubmit = new Set();"), end = source.indexOf("submitPrepared(mode", source.indexOf("\n\t\t\tsubmitPrepared(mode", start));
  assert.ok(start > 0 && end > start);
  const methods = source.slice(start, source.lastIndexOf("\n", end));
  const Shell = new Function(`return class { ${methods} }`)();
  const shell = new Shell(); shell.rev = 1; shell.attachmentIds = []; shell.disposed = false; shell.sent = []; shell.notices = [];
  shell.submitPrepared = (...args: any[]) => shell.sent.push(args); shell.notify = (...args: any[]) => shell.notices.push(args);
  return shell;
}
test("native click and keyboard submissions await pause once and preserve queue/steer", async () => {
  const shell = submissionHarness(); let release: any, pauses = 0;
  shell.beforeSubmit.add(() => { pauses++; return new Promise(resolve => { release = resolve; }); });
  shell.submit("steer", "enter"); shell.submit("queue", "click"); await flush();
  assert.equal(pauses, 1); assert.equal(shell.sent.length, 0);
  release(); await flush(); assert.deepEqual(shell.sent, [["steer", "enter"]]);
});
test("native submission guard refuses a changed draft or failed audio pause", async () => {
  const shell = submissionHarness(); let release: any;
  shell.beforeSubmit.add(() => new Promise(resolve => { release = resolve; }));
  shell.submit(); await flush(); shell.rev++; release(); await flush(); assert.equal(shell.sent.length, 0);
  shell.beforeSubmit.clear(); shell.beforeSubmit.add(() => { throw new Error("pause failed"); });
  shell.submit(); await flush(); assert.equal(shell.sent.length, 0); assert.equal(shell.notices[0][1], "pause failed");
});
test("a changed attachment list also invalidates a pending native send", async () => {
  const shell = submissionHarness(); let release: any;
  shell.beforeSubmit.add(() => new Promise(resolve => { release = resolve; }));
  shell.submit(); await flush(); shell.attachmentIds.push("new-file"); release(); await flush();
  assert.equal(shell.sent.length, 0);
});
