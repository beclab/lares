import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createVoiceKeyStore } from "@olares/lares-core/voice/keys";

test("voice keys store only hashes, verify by Bearer and take revocation without restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "lares-voice-keys-"));
  try {
    const path = join(dir, "keys.json");
    const store = createVoiceKeyStore({ path });
    const issued = store.issue({ name: "Router", models: ["voice-chat", "voice-chat"], sessionId: "session-1" });
    assert.match(issued.key, /^lvk_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(issued.models, ["voice-chat"]);
    assert.ok(!readFileSync(path, "utf8").includes(issued.key));
    assert.equal(store.list()[0].hash, undefined);
    assert.equal(store.verify(`Bearer ${issued.key}`)?.sessionId, "session-1");
    assert.equal(store.verify(issued.key), null);
    assert.equal(store.verify(`Bearer ${issued.key.slice(0, -1)}A`), null);
    assert.equal(createVoiceKeyStore({ path }).revoke(issued.id), true);
    assert.equal(store.verify(`Bearer ${issued.key}`), null);
    assert.equal(store.revoke(issued.id), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("voice keys reject unknown models and malformed names", () => {
  const dir = mkdtempSync(join(tmpdir(), "lares-voice-keys-"));
  try {
    const store = createVoiceKeyStore({ path: join(dir, "keys.json") });
    assert.throws(() => store.issue({ name: "x", models: [] }), { code: "voice_key_invalid" });
    assert.throws(() => store.issue({ name: "x", models: ["gpt-realtime"] }), { code: "voice_key_invalid" });
    assert.throws(() => store.issue({ name: "", models: ["voice-chat"] }), { code: "voice_key_invalid" });
    assert.throws(() => store.issue({ name: "a\nb", models: ["voice-chat"] }), { code: "voice_key_invalid" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
