import assert from "node:assert/strict";
import test from "node:test";
import { prepareBrowserCapture, createVoiceCapture } from "@olares/lares-core/voice/browser-capture";
import { createVoicePanel } from "@olares/lares-core/voice/panel";
import { createVoiceController } from "@olares/lares-core/voice/controller";
import { createDeviceInput } from "@olares/lares-core/voice/device-input";

const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function microphone() {
  const grant = deferred<any>(); let opens = 0, stops = 0, starts = 0;
  const stream = { getTracks: () => [{ stop() { stops++; } }] };
  class Recorder {
    state = "inactive"; mimeType = "audio/webm";
    ondataavailable: ((value: any) => void) | null = null; onstop: (() => void) | null = null;
    static isTypeSupported() { return true; }
    start() { starts++; this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob([new Uint8Array(4096)]) }); this.onstop?.(); }
  }
  const media = { mediaDevices: { getUserMedia() { opens++; return grant.promise; } }, MediaRecorder: Recorder };
  return { grant, stream, media, get opens() { return opens; }, get stops() { return stops; }, get starts() { return starts; } };
}

test("a dropped microphone is opened again on the next hold", async () => {
  const tracks: { readyState: string, stop(): void }[] = [];
  const media = { mediaDevices: { getUserMedia() {
    const track = { readyState: "live", stop() { this.readyState = "ended"; } };
    tracks.push(track);
    return Promise.resolve({ getTracks: () => [track] });
  } } };
  const preparation = prepareBrowserCapture({ media });
  const first = await preparation.opened();
  assert.equal(tracks.length, 1);
  tracks[0].readyState = "ended";
  const second = await preparation.borrow();
  assert.equal(tracks.length, 2);
  assert.notEqual(second, first);
  assert.equal(second.getTracks()[0], tracks[1]);
  preparation.cancel();
});

test("permission starts synchronously, transfers one stream once, and releases on dispose", async () => {
  const mic = microphone(); const timings: any[] = [];
  const preparation = prepareBrowserCapture({ media: mic.media, onTrace: (stage, fields) => timings.push({ stage, ...fields }) });
  assert.equal(mic.opens, 1);
  mic.grant.resolve(mic.stream);
  const cap = createVoiceCapture({ preparation, media: mic.media, transcribe: () => assert.fail("no ASR") });
  await cap.start(); assert.equal(cap.phase, "recording"); assert.equal(mic.opens, 1);
  await assert.rejects(preparation.consume(), /voice_cancelled/);
  cap.dispose(); assert.equal(mic.stops, 1);
  assert.deepEqual(timings.map(row => row.stage), ["permission-request", "permission", "ready"]);
  assert.ok(timings.every(row => Object.keys(row).sort().join() === "durationMs,stage"));
});

test("cancelled permission grants close every track without recording or ASR", async () => {
  const mic = microphone(); const preparation = prepareBrowserCapture({ media: mic.media });
  preparation.cancel(); mic.grant.resolve(mic.stream); await flush();
  assert.equal(mic.stops, 1); assert.equal(mic.starts, 0);
  await assert.rejects(preparation.consume(), /voice_cancelled/);
});

test("permission denial is preserved and never retries a denied grant", async () => {
  let opens = 0;
  const media = { mediaDevices: { getUserMedia() { opens++; return Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })); } }, MediaRecorder: microphone().media.MediaRecorder };
  const preparation = prepareBrowserCapture({ media });
  await flush();
  const phases: any[] = [];
  const cap = createVoiceCapture({ media, preparation, onPhase: (phase, fields) => phases.push({ phase, ...fields }) });
  await cap.start(); assert.equal(phases.at(-1).error, "voice_permission_denied"); assert.equal(opens, 1); cap.dispose();
});

test("finishing a prepared recording releases tracks before ASR and never opens a second stream", async () => {
  const mic = microphone(); let clock = 0, submissions = 0;
  const preparation = prepareBrowserCapture({ media: mic.media }); mic.grant.resolve(mic.stream);
  const cap = createVoiceCapture({ preparation, media: mic.media, now: () => clock,
    transcribe: async () => { assert.equal(mic.stops, 1); return "test"; }, submit: () => { submissions++; } });
  await cap.start(); clock = 1000; cap.stop();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(submissions, 1); assert.equal(mic.opens, 1); cap.dispose(); assert.equal(mic.stops, 1);
});

test("disposal during asynchronous recorder setup releases both stream and late meter", async () => {
  const mic = microphone(); const meter = deferred<any>(); let metersStopped = 0;
  const cap = createVoiceCapture({ media: mic.media, onStream: () => meter.promise });
  const starting = cap.start(); mic.grant.resolve(mic.stream); await flush(); cap.dispose();
  meter.resolve({ stop() { metersStopped++; } }); await starting;
  assert.equal(mic.starts, 0); assert.equal(mic.stops, 1); assert.equal(metersStopped, 1);
});

test("a closed recognizer socket does not keep an open microphone in the opening state", async () => {
  const mic = microphone(); let clock = 0, transcribed = 0;
  const preparation = prepareBrowserCapture({ media: mic.media });
  mic.grant.resolve(mic.stream);
  const cap = createVoiceCapture({
    preparation, media: mic.media, now: () => clock,
    streamInput: () => new Promise(() => {}),
    transcribe: async () => { transcribed++; return "hello"; },
    submit: () => {},
  });
  await cap.start();
  assert.equal(cap.phase, "recording");
  clock = 1000;
  cap.stop();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(transcribed, 1);
  cap.dispose();
});

test("unsupported recorder cancels and releases a prepared late stream", async () => {
  const mic = microphone(); const preparation = prepareBrowserCapture({ media: mic.media });
  const cap = createVoiceCapture({ media: { mediaDevices: mic.media.mediaDevices }, preparation });
  await cap.start(); mic.grant.resolve(mic.stream); await flush();
  assert.equal(cap.phase, "error"); assert.equal(mic.stops, 1); assert.equal(mic.starts, 0); cap.dispose();
});

for (const action of ["close", "bind", "discard", "pause"] as const) {
  test(`blocked remote stop does not block permission; ${action} releases a late grant`, async () => {
    const mic = microphone(); const remote = deferred<void>(); let loads = 0;
    const panel = createVoicePanel({
      loadConfig: async () => { loads++; return new Promise(() => {}); },
      prepareInput: () => prepareBrowserCapture({ media: mic.media }),
      complete: () => assert.fail("no insertion"),
      create: async ({ preparation, onTranscript }: any) => {
        const controller = createVoiceController({
          input: createDeviceInput({ preparation, media: mic.media, transcribe: () => assert.fail("no ASR") }), onTranscript,
          output: { stop: () => remote.promise },
          agent: { create: () => assert.fail("no task") },
        });
        return { controller, start: (args: any) => controller.start(args), stop: () => controller.disconnect(), pause: () => controller.pause() };
      },
    });
    const opening = panel.open({ configSnapshot: { device: "device" } });
    assert.equal(mic.opens, 1); assert.equal(panel.getSnapshot().visible, false); assert.equal(panel.getSnapshot().inputActive, false);
    await flush(); assert.equal(loads, 0); assert.equal(mic.starts, 0); assert.equal(panel.getSnapshot().startedAt, null);
    await panel.open({ configSnapshot: { device: "device" } }); assert.equal(mic.opens, 1);
    const cancelled = action === "bind" ? panel.bind("another") : panel[action]();
    mic.grant.resolve(mic.stream); await flush(); assert.equal(mic.stops, 1);
    remote.resolve(); await opening; await cancelled; assert.equal(mic.starts, 0); await panel.dispose();
  });
}

test("voice input stays on text until the microphone opens, and a denial never enters it", async () => {
  const mic = microphone();
  const granted = createVoicePanel({
    prepareInput: () => prepareBrowserCapture({ media: mic.media }),
    loadConfig: async () => { throw new Error("no settings"); },
    complete: () => {},
    create: async () => { throw new Error("no call"); },
  });
  const opening = granted.open({ mode: "continuous", configSnapshot: { device: "device" } });
  await flush();
  assert.equal(mic.opens, 1); assert.equal(granted.getSnapshot().inputActive, false);
  mic.grant.resolve(mic.stream); await opening;
  assert.equal(granted.getSnapshot().inputActive, true); assert.equal(mic.opens, 1);
  await granted.dispose();

  let deniedOpens = 0;
  const denied = createVoicePanel({
    prepareInput: () => prepareBrowserCapture({ media: { mediaDevices: { getUserMedia() { deniedOpens++; return Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })); } }, MediaRecorder: mic.media.MediaRecorder } }),
    loadConfig: async () => { throw new Error("no settings"); },
    complete: () => {},
    create: async () => { throw new Error("no call"); },
  });
  await denied.open({ mode: "continuous", configSnapshot: { device: "device" } });
  assert.equal(deniedOpens, 1); assert.equal(denied.getSnapshot().visible, false); assert.equal(denied.getSnapshot().inputActive, false);
  assert.equal(denied.getSnapshot().error, "voice_permission_denied");
  await denied.dispose();
});

test("later holds reuse the microphone opened for the voice session", async () => {
  const mic = microphone();
  const preparation = prepareBrowserCapture({ media: mic.media });
  mic.grant.resolve(mic.stream);
  await preparation.opened();
  const input = createDeviceInput({ preparation, media: mic.media, transcribe: async () => "hi" });
  const first = input.capture({ continuous: true, manual: true });
  await flush();
  input.cancel();
  await first;
  const second = input.capture({ continuous: true, manual: true });
  await flush();
  input.cancel();
  await second;
  assert.equal(mic.opens, 1); assert.equal(mic.stops, 0);
  preparation.cancel();
  assert.equal(mic.stops, 1);
});

test("light capability loading ignores blocked diagnostics and retains last good capability on failure", async () => {
  const original = globalThis.fetch; const paths: string[] = []; let failed = false;
  globalThis.fetch = async input => {
    const path = String(input); paths.push(path);
    if (path.includes("/capabilities")) { if (failed) throw new Error("offline"); return Response.json({ stt: ["asr"], selected: "asr" }); }
    if (path.includes("/config")) return Response.json({ model: "asr", language: "zh" });
    return new Promise(() => {});
  };
  try {
    const client = await import(`../../packages/core/voice/client.js?startup=${Date.now()}`);
    const full = client.loadVoiceSettings(); void full;
    await flush();
    const light = await client.loadVoiceSettings({ diagnostics: false });
    assert.deepEqual(light.sttModels, ["asr"]); assert.ok(paths.some(path => path.endsWith("/models")));
    failed = true;
    await assert.rejects(client.loadVoiceSettings({ diagnostics: false, force: true }), /offline/);
    assert.deepEqual(client.rememberedVoiceSettings().sttModels, ["asr"]);
  } finally { globalThis.fetch = original; }
});

test("saving config returns immediately without diagnostics and fences an older config fetch", async () => {
  const original = globalThis.fetch; const oldConfig = deferred<Response>();
  let configReads = 0;
  globalThis.fetch = async (input, options) => {
    const path = String(input);
    if (options?.method === "POST") return Response.json({ model: "new" });
    if (path.includes("/config")) return configReads++ ? oldConfig.promise : Response.json({ model: "old" });
    if (path.includes("/capabilities")) return Response.json({ stt: ["old", "new"], selected: "old" });
    return new Promise(() => {});
  };
  try {
    const client = await import(`../../packages/core/voice/client.js?save=${Date.now()}`);
    await client.loadVoiceSettings({ diagnostics: false });
    const loading = client.loadVoiceSettings({ diagnostics: false, force: true }); await flush();
    const saved = await client.saveVoiceSettings({ model: "new" });
    assert.equal(saved.config.model, "new");
    oldConfig.resolve(Response.json({ model: "old" }));
    await loading; assert.equal(client.rememberedVoiceSettings().config.model, "new");
  } finally { globalThis.fetch = original; }
});
