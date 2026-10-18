import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { laresVoiceConfig, laresVoiceAvailability } from "@olares/lares-core/voice/lares-policy";
import { createVoiceHostService } from "@olares/lares-core/voice/host-service";
import { createVoiceRecords } from "@olares/lares-core/voice/records";
import { createVoiceConversation } from "@olares/lares-core/voice/conversation";
import { defaultDictationProfiles } from "@olares/lares-core/voice/dictation";

for (const preset of ["dictation", "chat", "assistant", "direct"]) for (const backend of ["pipeline", "realtime"]) {
  test(`Lares entry policy overrides ${preset}/${backend} per connection without changing API defaults`, () => {
    const saved = { preset, backend, chatModel: "unavailable-voice-chat", dictationProfiles: defaultDictationProfiles(), speak: true };
    const original = structuredClone(saved);
    assert.equal(laresVoiceConfig(saved, "single").preset, "dictation");
    const direct = laresVoiceConfig(saved); assert.equal(direct.preset, "direct"); assert.equal(direct.backend, "pipeline");
    direct.dictationProfiles.clean.model = "changed"; assert.deepEqual(saved, original);
    const settings = { config: saved, sttModels: ["asr"], ttsModels: ["tts"], chatModels: [] };
    assert.equal(laresVoiceAvailability(settings, true).conversation, true);
    assert.equal(laresVoiceAvailability(settings, false).conversation, false);
    assert.equal(laresVoiceAvailability(settings, false).dictation, true);
    assert.equal(laresVoiceAvailability({ ...settings, sttModels: [] }, true).dictation, false);
    assert.equal(laresVoiceAvailability({ ...settings, ttsModels: [] }, true).conversation, false);
  });
}

test("direct Lares speech uses its bound dsh session and queue/steer with no voice-chat or summary LLM", async () => {
  const directory = mkdtempSync(join(tmpdir(), "lares-entry-policy-"));
  const submitted: any[] = [], created: any[] = [];
  const api = { inspect: async (id: string) => { assert.equal(id, "existing"); return {}; }, create: async (input: any) => { created.push(input); return { sessionId: "new" }; },
    async *follow(_: any, signal: AbortSignal) { yield { type: "snapshot", records: [] }; await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })); },
    prompt: async (input: any) => { submitted.push(input); return { accepted: true }; } };
  const saved = { preset: "assistant", backend: "realtime", chatModel: "must-not-call" };
  const service = createVoiceHostService(api, { records: createVoiceRecords({ directory }), config: () => saved, chat: () => assert.fail("direct speech must not invoke a separate LLM") });
  const scope: any = { id: "voice-one", owner: "alice" };
  try {
    await service.open(scope, { sessionId: "existing", preset: "direct", backend: "pipeline", presentationSession: true });
    assert.equal(scope.voiceConfig.backend, "pipeline"); assert.equal(scope.dialogue, null); assert.deepEqual(created, []);
    await service.prompt(scope, { text: "keep numbers", requestId: "one", mode: "queue" });
    await service.prompt(scope, { text: "keep numbers", requestId: "one", mode: "queue" });
    await service.prompt(scope, { text: "new condition", requestId: "two", mode: "steer" });
    assert.equal(submitted.length, 2); assert.deepEqual(submitted.map(value => [value.sessionId, value.mode]), [["existing", "queue"], ["existing", "steer"]]);
    assert.equal(saved.preset, "assistant"); assert.equal(saved.backend, "realtime");
  } finally { await service.close(scope); rmSync(directory, { recursive: true, force: true }); }
});

test("omitted API overrides retain preset/backend; invalid backend is rejected", async () => {
  const directory = mkdtempSync(join(tmpdir(), "lares-api-policy-"));
  const scope: any = { id: "api-client", owner: "alice" };
  const saved = { preset: "chat", backend: "realtime" };
  const service = createVoiceHostService({}, { records: createVoiceRecords({ directory }), config: () => saved, chat: async () => ({ content: "hello" }) });
  try {
    await service.open(scope, {}); assert.equal(scope.voiceConfig.preset, "chat"); assert.equal(scope.voiceConfig.backend, "realtime");
    await service.prompt(scope, { text: "hi", requestId: "one" }); assert.equal(service.state(scope).utterance.text, "hello"); await service.close(scope);
    await assert.rejects(service.open(scope, { backend: "unknown" }), /invalid backend/);
    assert.equal(saved.backend, "realtime");
  } finally { await service.close(scope); rmSync(directory, { recursive: true, force: true }); }
});

test("conversation reopen keeps connection policy overrides", async () => {
  const requests: any[] = []; let active = false;
  const call = createVoiceConversation({ preset: "direct", backend: "pipeline", presentationSession: true, request: async (_path: string, options: any = {}) => {
    requests.push(options.body); if (options.body?.preset) active = true;
    return { ok: true, body: { active, sessionId: "s", version: 1, running: false } };
  }, playback: { stop() {} }, input: { capture: () => new Promise(() => {}), cancel() {}, stop() {} } });
  await call.start({ manual: true }); active = false; await call.pause(); await call.resume();
  const opened = requests.filter(value => value?.sessionId !== undefined && value?.readAloud !== undefined);
  assert.equal(opened.length, 2); assert.ok(opened.every(value => value.preset === "direct" && value.backend === "pipeline")); await call.stop();
});

