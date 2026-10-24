import assert from "node:assert/strict";
import test from "node:test";
import { speechSeconds } from "@olares/lares-core/router/stt";
import { createRouterAudio } from "@olares/lares-core/voice/router-audio";

test("Router VAD answers seconds of speech and null whenever it cannot tell", async () => {
  const original = globalThis.fetch;
  const seen: any[] = [];
  try {
    globalThis.fetch = (async (url: string, init: any) => { seen.push({ url, init }); return Response.json({ speech_seconds: 1.25, num_segments: 1 }); }) as any;
    assert.equal(await speechSeconds({ bytes: Buffer.from("RIFF"), headers: { "x-session-id": "rtc_1" } }), 1.25);
    assert.match(seen[0].url, /\/audio\/vad$/);
    assert.equal(seen[0].init.headers["x-session-id"], "rtc_1");
    assert.match(Buffer.from(seen[0].init.body).toString("latin1"), /name="model"\r\n\r\ndefault-vad/);
    globalThis.fetch = (async () => new Response("busy", { status: 503 })) as any;
    assert.equal(await speechSeconds({ bytes: Buffer.from("RIFF") }), null);
    globalThis.fetch = (async () => { throw new Error("down"); }) as any;
    assert.equal(await speechSeconds({ bytes: Buffer.from("RIFF") }), null);
    globalThis.fetch = (async () => Response.json({ duration: 1 })) as any;
    assert.equal(await speechSeconds({ bytes: Buffer.from("RIFF") }), null);
  } finally { globalThis.fetch = original; }
});

test("the Router audio adapter sends a take to VAD as 16 kHz WAV", async () => {
  const original = globalThis.fetch;
  let body: Buffer = Buffer.alloc(0);
  try {
    globalThis.fetch = (async (_url: string, init: any) => { body = Buffer.from(init.body); return Response.json({ speech_seconds: 0 }); }) as any;
    const audio = createRouterAudio(() => ({}));
    // One second at 24 kHz PCM16.
    assert.equal(await audio.detectSpeech(Buffer.alloc(48000), { routerSessionId: "rtc_2" }), 0);
    const wav = body.subarray(body.indexOf("RIFF"));
    assert.equal(wav.readUInt32LE(24), 16000);
    assert.equal(wav.readUInt32LE(40), 32000);
  } finally { globalThis.fetch = original; }
});
