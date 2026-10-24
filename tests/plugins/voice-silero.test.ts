import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSileroGate } from "@olares/lares-core/voice/silero";

// 24 kHz PCM16 in 10 ms chunks, the way Reachy Mini sends its microphone.
const chunks = (seconds: number, sample: (i: number) => number) => Array.from({ length: seconds * 100 }, (_, c) => {
  const pcm = Buffer.alloc(480);
  for (let i = 0; i < 240; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample(c * 240 + i))) * 32767), i * 2);
  return pcm;
});

test("Silero hears a room as loud as Reachy's as nobody speaking", async () => {
  const gate = await createSileroGate();
  // About the level pptest03's robot reported: median chunk RMS 0.016, bursts past 0.05.
  let seed = 7;
  const noise = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return (seed / 2 ** 30 - 1) * 0.028; };
  let loudest = 0;
  for (const chunk of chunks(3, (i) => noise() * (i % 4800 < 480 ? 2.5 : 1))) {
    gate.hear(chunk);
    loudest = Math.max(loudest, await gate.settled());
  }
  assert.ok(loudest < 0.35, String(loudest));
  assert.equal(gate.voiced(1, false), false);
});

test("Silero takes chunks that do not line up with its 32 ms frames", async () => {
  const gate = await createSileroGate();
  for (const chunk of chunks(1, () => 0)) gate.hear(chunk.subarray(0, 478)); // 239 samples each
  assert.ok(await gate.settled() < 0.35);
  assert.equal(gate.voiced(0, false), false);
});

// Real speech needs a voice; macOS has one, so the check runs where `say` exists.
const hasSay = (() => { try { execFileSync("which", ["say"], { stdio: "ignore" }); return true; } catch { return false; } })();
test("Silero hears speech over that same room", { skip: !hasSay && "needs macOS say" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "silero-"));
  execFileSync("say", ["-o", join(dir, "zh.aiff"), "你好，帮我把客厅的灯关掉"]);
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@24000", "-c", "1", join(dir, "zh.aiff"), join(dir, "zh.wav")]);
  const wav = readFileSync(join(dir, "zh.wav"));
  const data = wav.subarray(wav.indexOf("data") + 8);
  const gate = await createSileroGate();
  let loudest = 0;
  for (let offset = 0; offset + 480 <= data.length; offset += 480) {
    gate.hear(data.subarray(offset, offset + 480));
    loudest = Math.max(loudest, await gate.settled());
  }
  assert.ok(loudest > 0.9, String(loudest));
});
