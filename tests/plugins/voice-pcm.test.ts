import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { VoiceError } from "@olares/lares-core/router/stt";
import { normalizeSttPcm, sttInputExtension, sttPcmArgs } from "@olares/lares-core/voice/pcm";

function wavHeader() {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(0, 40);
  return header;
}

test("speech audio is normalized to 16 kHz mono PCM", async () => {
  const seen: string[][] = [];
  let captured = "";
  const wav = await normalizeSttPcm(Buffer.from("webm-bytes"), "audio/webm;codecs=opus", {
    ffmpegBin: "ffmpeg",
    spawnFn: ((bin: string, args: string[]) => {
      seen.push([bin, ...args]);
      const input = args.find((arg) => arg.endsWith(".webm")) ?? "";
      captured = readFileSync(input).toString();
      writeFileSync(args.at(-1) ?? "", wavHeader());
      return {
        stderr: { on() {} },
        kill() {},
        on(event: string, cb: (code?: number) => void) {
          if (event === "close") cb(0);
        },
      };
    }) as never,
  });
  assert.equal(sttInputExtension("audio/webm;codecs=opus"), "webm");
  assert.equal(captured, "webm-bytes");
  assert.equal(seen[0][seen[0].indexOf("-ac") + 1], "1");
  assert.equal(seen[0][seen[0].indexOf("-ar") + 1], "16000");
  assert.equal(wav.readUInt32LE(24), 16_000);
  assert.equal(wav.readUInt16LE(22), 1);
});

test("a capture ffmpeg cannot decode is rejected", async () => {
  await assert.rejects(
    () => normalizeSttPcm(Buffer.from("nope"), "audio/webm", {
      spawnFn: (() => ({
        stderr: { on(_event: string, cb: (chunk: Buffer) => void) { cb(Buffer.from("Invalid data")); } },
        kill() {},
        on(event: string, cb: (code?: number) => void) {
          if (event === "close") cb(1);
        },
      })) as never,
    }),
    (err: unknown) => err instanceof VoiceError && err.code === "voice_audio_unreadable",
  );
});

test("stt pcm args resample whatever was recorded", () => {
  const args = sttPcmArgs("/tmp/in.webm", "/tmp/out.wav");
  assert.deepEqual(args.slice(args.indexOf("-ac")), [
    "-ac", "1",
    "-ar", "16000",
    "-c:a", "pcm_s16le",
    "-f", "wav",
    "/tmp/out.wav",
  ]);
});
