import assert from "node:assert/strict";
import test from "node:test";
import { createVoicePreferences, createPreferencesGuard } from "@olares/lares-core/voice/preferences";
import { createVoiceShortcutRecorder, formatVoiceShortcut, validateVoiceShortcuts } from "@olares/lares-core/voice/shortcuts";
import { defaultDictationProfiles, DICTATION_INSTRUCTIONS } from "@olares/lares-core/voice/dictation";

const flush = () => new Promise(resolve => setImmediate(resolve));
const shortcuts = () => ({ default: "", raw: "", clean: "", outline: "", summary: "" });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function harness() {
  let config: any = { dictationPreset: "clean", dictationProfiles: defaultDictationProfiles(), dictationShortcuts: shortcuts(), model: "asr", streaming: true };
  const calls: any[] = []; let fail = false; let gate: Promise<void> | null = null;
  const preferences = createVoicePreferences({ load: async options => { assert.equal(options.diagnostics, false); return { config: structuredClone(config), sttModels: ["asr"], chatModels: ["chat"] }; },
    save: async partial => { calls.push(partial); if (gate) await gate; if (fail) throw new Error("failed"); config = { ...config, ...partial }; return { config: structuredClone(config), sttModels: ["asr"] }; } });
  return { preferences, calls, get config() { return config; }, fail(value = true) { fail = value; }, gate(value: Promise<void>) { gate = value; } };
}

test("preset model and instructions stay drafts until save; other preset/default/streaming are preserved", async () => {
  const h = harness(); await h.preferences.load();
  h.preferences.edit("outline", { model: "chat", instructions: "Keep names" });
  assert.deepEqual(h.calls, []); assert.deepEqual(h.preferences.dirtyIds(), ["outline"]);
  assert.equal(h.config.dictationPreset, "clean"); assert.notEqual(h.config.dictationProfiles.outline.model, "chat");
  await h.preferences.saveProfile("outline");
  assert.equal(h.config.dictationProfiles.outline.model, "chat"); assert.equal(h.config.dictationPreset, "clean"); assert.equal(h.config.streaming, true);
  assert.deepEqual(h.preferences.dirtyIds(), []); assert.equal(h.config.dictationProfiles.clean.instructions, DICTATION_INSTRUCTIONS.clean);
});

test("failed profile save preserves editing, restore is only a draft, and refresh cannot erase it", async () => {
  const h = harness(); await h.preferences.load(); h.preferences.edit("clean", { instructions: "custom" }); h.fail();
  await assert.rejects(h.preferences.saveProfile("clean")); assert.equal(h.preferences.profile("clean").instructions, "custom");
  await h.preferences.load(true); assert.equal(h.preferences.profile("clean").instructions, "custom");
  h.preferences.restore("clean"); assert.equal(h.calls.length, 1); assert.equal(h.preferences.profile("clean").instructions, DICTATION_INSTRUCTIONS.clean);
  h.preferences.edit("clean", { instructions: "try again" }); h.fail(false); await h.preferences.saveDirty(); assert.deepEqual(h.preferences.dirtyIds(), []);
});

test("queued writes merge latest profiles and shortcuts instead of overwriting another saved row", async () => {
  const h = harness(); await h.preferences.load(); const gate = deferred<void>(); h.gate(gate.promise);
  h.preferences.edit("clean", { model: "first" }); h.preferences.edit("summary", { model: "second" });
  const first = h.preferences.saveProfile("clean"), second = h.preferences.saveProfile("summary");
  const key1 = h.preferences.saveShortcut("raw", "Ctrl+Shift+1"), key2 = h.preferences.saveShortcut("outline", "Ctrl+Shift+2");
  await flush(); assert.equal(h.calls.length, 1); gate.resolve(); await Promise.all([first, second, key1, key2]);
  assert.equal(h.config.dictationProfiles.clean.model, "first"); assert.equal(h.config.dictationProfiles.summary.model, "second");
  assert.equal(h.config.dictationShortcuts.raw, "Ctrl+Shift+1"); assert.equal(h.config.dictationShortcuts.outline, "Ctrl+Shift+2");
});

test("a save in flight does not clear an edit made after that save started", async () => {
  const h = harness(); await h.preferences.load(); const gate = deferred<void>(); h.gate(gate.promise);
  h.preferences.edit("clean", { instructions: "one" }); const saving = h.preferences.saveProfile("clean"); await flush();
  h.preferences.edit("clean", { instructions: "two" }); gate.resolve(); await saving;
  assert.equal(h.config.dictationProfiles.clean.instructions, "one"); assert.equal(h.preferences.profile("clean").instructions, "two"); assert.equal(h.preferences.dirty("clean"), true);
});

function recorderHarness() {
  let current = shortcuts(); const saved: any[] = []; let reject = false; let gate: Promise<void> | null = null;
  const recorder = createVoiceShortcutRecorder({ current: () => current, save: async (id, key) => { saved.push([id, key]); if (gate) await gate; if (reject) throw new Error("failed"); current = validateVoiceShortcuts({ ...current, [id]: key }); } });
  return { recorder, saved, get current() { return current; }, fail(value: boolean) { reject = value; }, gate(value: Promise<void>) { gate = value; } };
}
const combo = { key: "!", code: "Digit1", ctrlKey: true, shiftKey: true };
test("shortcut records on main-key release, ignores modifiers/repeats/IME, and formats Mac keys", async () => {
  const h = recorderHarness(); h.recorder.begin("raw");
  h.recorder.keydown({ key: "Control", code: "ControlLeft", ctrlKey: true }); assert.equal(h.recorder.getSnapshot().candidate, "");
  h.recorder.keydown({ ...combo, repeat: true }); h.recorder.keydown({ ...combo, isComposing: true }); assert.deepEqual(h.saved, []);
  h.recorder.keydown(combo); assert.deepEqual(h.saved, []);
  h.recorder.keyup({ key: "Shift", code: "ShiftLeft" }); assert.deepEqual(h.saved, []);
  h.recorder.keyup(combo); await flush(); assert.deepEqual(h.saved, [["raw", "Ctrl+Shift+1"]]);
  assert.equal(formatVoiceShortcut("Meta+Alt+Shift+k", true), "⌘⌥⇧K"); assert.equal(formatVoiceShortcut("Ctrl+Shift+1"), "Ctrl+Shift+1");
});

test("Esc, Tab and focus cancellation keep old binding; only one recorder is active", async () => {
  const h = recorderHarness(); h.recorder.begin("clean"); h.recorder.keydown(combo); assert.equal(h.recorder.keydown({ key: "Escape" }), true);
  h.recorder.keyup(combo); assert.deepEqual(h.saved, []);
  h.recorder.begin("clean"); assert.equal(h.recorder.keydown({ key: "Tab" }), false); assert.equal(h.recorder.getSnapshot().action, null);
  h.recorder.begin("raw"); h.recorder.begin("summary"); assert.equal(h.recorder.getSnapshot().action, "summary");
  h.recorder.cancel(); h.recorder.keyup(combo); assert.deepEqual(h.saved, []);
});

test("shortcut invalid/reserved/duplicate errors are distinct and do not change bindings", async () => {
  const h = recorderHarness(); h.recorder.begin("raw"); h.recorder.keydown({ key: "a", code: "KeyA" }); assert.equal(h.recorder.getSnapshot().errors.raw, "invalid");
  h.recorder.keydown({ key: "r", code: "KeyR", ctrlKey: true }); assert.equal(h.recorder.getSnapshot().errors.raw, "reserved");
  h.recorder.keydown(combo); h.recorder.keyup(combo); await flush(); h.recorder.begin("clean"); h.recorder.keydown(combo);
  assert.equal(h.recorder.getSnapshot().errors.clean, "duplicate"); h.recorder.keyup(combo); assert.equal(h.saved.length, 1);
});

test("failed shortcut save keeps original; retry and clear work and only that row is pending", async () => {
  const h = recorderHarness(); h.fail(true); h.recorder.begin("clean"); h.recorder.keydown(combo); h.recorder.keyup(combo); await flush();
  assert.equal(h.current.clean, ""); assert.equal(h.recorder.getSnapshot().errors.clean, "save");
  h.fail(false); await h.recorder.retry("clean"); assert.equal(h.current.clean, "Ctrl+Shift+1");
  const gate = deferred<void>(); h.gate(gate.promise); const clearing = h.recorder.clear("clean"); assert.equal(h.recorder.getSnapshot().pending.clean, true);
  h.recorder.begin("raw"); assert.equal(h.recorder.getSnapshot().action, "raw"); gate.resolve(); await clearing; assert.equal(h.current.clean, "");
});

test("opening and refreshing preferences call only config and capabilities, never installation or GPU APIs", async () => {
  const original = globalThis.fetch; const paths: string[] = [];
  const config = { dictationPreset: "clean", dictationProfiles: defaultDictationProfiles(), dictationShortcuts: shortcuts(), streaming: true };
  globalThis.fetch = async input => {
    const path = String(input); paths.push(path);
    if (path.endsWith("/config")) return Response.json(config);
    if (path.includes("/capabilities")) return Response.json({ stt: ["asr"], tts: ["tts"], chat: ["chat"] });
    throw new Error(`Unexpected runtime request: ${path}`);
  };
  try {
    const client = await import(`../../packages/core/voice/client.js?preferences=${Date.now()}`);
    const preferences = createVoicePreferences({ load: client.loadVoiceSettings, save: () => assert.fail("opening preferences must not mutate configuration") });
    await preferences.load(); await preferences.load(true);
    assert.deepEqual(paths, ["/api/lares/voice/config", "/api/lares/voice/capabilities", "/api/lares/voice/config", "/api/lares/voice/capabilities?refresh=1"]);
    assert.equal(preferences.getSnapshot().value.config.streaming, true);
  } finally { globalThis.fetch = original; }
});

test("editing another preset preserves drafts and default; shared leave guard supports continue/discard/save failure/retry", async () => {
  let config = { dictationPreset: "clean", dictationProfiles: defaultDictationProfiles() }; let fail = true;
  const preferences = createVoicePreferences({ load: async () => ({ config }), save: async patch => { if (fail) throw new Error("failed"); config = { ...config, ...patch }; return { config }; } });
  await preferences.load(); assert.equal(preferences.getSnapshot().editing, "clean");
  preferences.edit("clean", { instructions: "unsaved" }); preferences.selectPreset("outline"); assert.equal(preferences.getSnapshot().value.config.dictationPreset, "clean");
  preferences.selectPreset("clean"); assert.equal(preferences.profile("clean").instructions, "unsaved");
  const guard = createPreferencesGuard(preferences); let answer = guard.request(); await guard.answer("continue"); assert.equal(await answer, false);
  answer = guard.request(); await guard.answer("save"); assert.equal(guard.getSnapshot().error, true); assert.equal(guard.getSnapshot().open, true);
  fail = false; await guard.answer("save"); assert.equal(await answer, true); assert.equal(config.dictationProfiles.clean.instructions, "unsaved");
  preferences.edit("clean", { instructions: "discard me" }); answer = guard.request(); await guard.answer("discard"); assert.equal(await answer, true); assert.deepEqual(preferences.dirtyIds(), []); guard.dispose();
});
