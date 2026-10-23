import assert from "node:assert/strict";
import test from "node:test";
import { createVoiceCapture } from "@olares/lares-core/voice/browser-capture";
import { defaultRequest } from "../../packages/mobile/src/host.js";

test("the default request port sends a recorded Blob as bytes, not as JSON", async () => {
  const original = globalThis.fetch;
  const seen: { body: unknown; type: string | undefined }[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    seen.push({ body: init.body, type: (init.headers as Record<string, string>)["content-type"] });
    return new Response(JSON.stringify({ text: "你好" }), { status: 200 });
  }) as typeof fetch;
  try {
    const blob = new Blob([new Uint8Array(4096)], { type: "audio/webm;codecs=opus" });
    await defaultRequest("/api/lares/voice/transcribe", {
      method: "POST",
      headers: { "content-type": blob.type },
      body: blob,
    });
    await defaultRequest("/api/lares/log", { method: "POST", body: { event: "x" } });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(seen[0].body instanceof Blob, true);
  assert.equal((seen[0].body as Blob).size, 4096);
  assert.equal(seen[0].type, "audio/webm;codecs=opus");
  assert.equal(seen[1].body, '{"event":"x"}');
  assert.equal(seen[1].type, "application/json");
});

test("releasing the button stops the clock right away", async () => {
  const phases: string[] = [];
  let clock = 0;
  class Recorder {
    state = "inactive";
    mimeType = "audio/webm";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    static isTypeSupported() {
      return true;
    }
    start() {
      this.state = "recording";
    }
    requestData() {}
    stop() {
      setTimeout(() => {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob([new Uint8Array(4096)]) });
        this.onstop?.();
      }, 20);
    }
  }
  const cap = createVoiceCapture({
    transcribe: async () => "好",
    onPhase: (phase) => phases.push(phase),
    now: () => clock,
    media: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) }, MediaRecorder: Recorder },
  });
  await cap.start();
  clock = 1500;
  cap.stop(false);
  assert.equal(cap.phase, "transcribing");
  await delay(120);
  assert.equal(phases.at(-1), "idle");
  cap.dispose();
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function harness(options: {
  transcribe?: (blob: Blob) => Promise<string> | string;
  open?: (constraints: { audio: unknown }) => Promise<{ getTracks: () => { stop: () => void }[] }>;
} = {}) {
  const phases: { phase: string; error?: string }[] = [];
  const calls: { audio: unknown }[] = [];
  let draft = "";
  const sent: string[] = [];
  let clock = 5_000;
  let recorder: { timeslice?: number; state: string } | null = null;
  const stream = { getTracks: () => [{ stop() {} }] };

  class Recorder {
    state = "inactive";
    mimeType = "audio/webm";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    timeslice?: number;
    constructor() {
      recorder = this;
    }
    static isTypeSupported() {
      return true;
    }
    start(timeslice?: number) {
      this.timeslice = timeslice;
      this.state = "recording";
    }
    requestData() {}
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob([new Uint8Array(4096)], { type: this.mimeType }) });
      this.onstop?.();
    }
  }

  const cap = createVoiceCapture({
    transcribe: async (blob) => {
      if (options.transcribe) return options.transcribe(blob);
      return "你好";
    },
    submit: (text: string) => {
      sent.push(text);
    },
    onPhase: (phase, extra = {}) => {
      phases.push({ phase, error: extra.error });
    },
    now: () => clock,
    media: {
      mediaDevices: {
        getUserMedia: async (constraints: { audio: unknown }) => {
          calls.push(constraints);
          if (options.open) return options.open(constraints);
          return stream;
        },
      },
      MediaRecorder: Recorder,
    },
  });

  return {
    cap,
    phases,
    calls,
    sent,
    stream,
    get draft() {
      return draft;
    },
    get recorder() {
      return recorder;
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

test("a finger-up while the mic is still opening is reported, not dropped", async () => {
  let release: (stream: { getTracks: () => { stop: () => void }[] }) => void = () => {};
  const pendingMic = new Promise<{ getTracks: () => { stop: () => void }[] }>((resolve) => {
    release = resolve;
  });
  const box = harness({ open: () => pendingMic });
  const pending = box.cap.start();
  assert.equal(box.cap.phase, "preparing");
  box.cap.stop(false);
  release(box.stream);
  await pending;
  await delay(80);
  assert.equal(box.phases.some((item) => item.phase === "error" && item.error === "voice_too_short"), true);
  assert.equal(box.sent.length, 0);
  box.cap.dispose();
});

test("leaving the page while the mic is opening cancels without an error", async () => {
  let release: (stream: { getTracks: () => { stop: () => void }[] }) => void = () => {};
  const pendingMic = new Promise<{ getTracks: () => { stop: () => void }[] }>((resolve) => {
    release = resolve;
  });
  const box = harness({ open: () => pendingMic });
  const pending = box.cap.start();
  box.cap.stop(true);
  release(box.stream);
  await pending;
  await delay(80);
  assert.equal(box.cap.phase, "idle");
  assert.equal(box.phases.some((item) => item.phase === "error"), false);
  assert.equal(box.sent.length, 0);
  box.cap.dispose();
});

test("the phone mic falls back when the exact headset profile is rejected, then sends the take", async () => {
  let attempt = 0;
  const box = harness({
    open: (constraints) => {
      attempt += 1;
      if (attempt === 1) {
        assert.deepEqual((constraints.audio as { echoCancellation: unknown }).echoCancellation, { ideal: true });
        const err = new Error("overconstrained");
        err.name = "OverconstrainedError";
        throw err;
      }
      assert.equal(constraints.audio, true);
      return Promise.resolve(box.stream);
    },
  });
  await box.cap.start();
  assert.equal(box.cap.phase, "recording");
  assert.equal(box.recorder?.timeslice, 250);
  box.advance(1000);
  box.cap.stop(false);
  await delay(80);
  assert.equal(box.draft, "");
  assert.deepEqual(box.sent, ["你好"]);
  box.cap.dispose();
});

test("a denied microphone is shown as a permission error", async () => {
  const box = harness({
    open: () => {
      const err = new Error("denied");
      err.name = "NotAllowedError";
      throw err;
    },
  });
  await box.cap.start();
  assert.equal(box.cap.phase, "error");
  assert.equal(box.phases.at(-1)?.error, "voice_permission_denied");
  assert.equal(box.calls.length, 1);
  box.cap.dispose();
});

test("an empty stream result still sends the recording", async () => {
  const seen: Blob[] = [];
  const sent: string[] = [];
  let clock = 0;
  const cap = createVoiceCapture({
    transcribe: async (blob) => {
      seen.push(blob);
      return "记下了";
    },
    streamInput: () => ({ finish: async () => "", cancel() {} }),
    submit: (text: string) => sent.push(text),
    now: () => clock,
    media: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) }, MediaRecorder: class {
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      static isTypeSupported() { return true; }
      start() { this.state = "recording"; }
      requestData() {}
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob([new Uint8Array(4096)]) });
        this.onstop?.();
      }
    } },
  });
  await cap.start();
  clock = 1000;
  cap.stop(false);
  await delay(80);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].size, 4096);
  assert.deepEqual(sent, ["记下了"]);
  cap.dispose();
});

test("a recorder that never stops still transcribes the chunks it already gave", async () => {
  const seen: Blob[] = [];
  class Recorder {
    state = "inactive";
    mimeType = "audio/webm";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    static isTypeSupported() { return true; }
    start() {
      this.state = "recording";
      this.ondataavailable?.({ data: new Blob([new Uint8Array(4096)]) });
    }
    requestData() {}
    stop() { /* WebView dropped onstop */ }
  }
  let clock = 0;
  const sent: string[] = [];
  const cap = createVoiceCapture({
    transcribe: async (blob) => { seen.push(blob); return "还在"; },
    submit: (text: string) => sent.push(text),
    now: () => clock,
    media: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) }, MediaRecorder: Recorder },
  });
  await cap.start();
  clock = 1000;
  cap.stop(false);
  assert.equal(cap.phase, "transcribing");
  await delay(1100);
  assert.equal(seen.length, 1);
  assert.deepEqual(sent, ["还在"]);
  cap.dispose();
});

test("silence from the recognizer is an error, not an empty send", async () => {
  const box = harness({ transcribe: async () => "" });
  await box.cap.start();
  box.advance(1000);
  box.cap.stop(false);
  await delay(80);
  assert.equal(box.cap.phase, "error");
  assert.equal(box.phases.at(-1)?.error, "voice_no_input");
  assert.equal(box.sent.length, 0);
  box.cap.dispose();
});


test("a manual hold in a call does not auto-stop, and silence ends only that take", async () => {
  const { createDeviceInput } = await import("@olares/lares-core/voice/device-input");
  let endpoints = 0;
  let opened = () => {};
  const ready = new Promise<void>((resolve) => { opened = resolve; });
  class Recorder {
    state = "inactive";
    mimeType = "audio/webm";
    onstop: (() => void) | null = null;
    static isTypeSupported() { return true; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.onstop?.(); }
    requestData() {}
  }
  const input = createDeviceInput({
    media: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) }, MediaRecorder: Recorder },
    transcribe: async () => "",
    endpoint: () => { endpoints += 1; return { stop() {} }; },
    onPhase: (phase: string) => { if (phase === "recording") opened(); },
  });
  const pending = input.capture({ continuous: true, manual: true });
  await ready;
  assert.equal(endpoints, 0);
  input.stop();
  assert.equal(await pending, "");
});

test("dictation silence is still a failed take", async () => {
  const { createDeviceInput } = await import("@olares/lares-core/voice/device-input");
  let opened = () => {};
  const ready = new Promise<void>((resolve) => { opened = resolve; });
  class Recorder {
    state = "inactive";
    mimeType = "audio/webm";
    onstop: (() => void) | null = null;
    static isTypeSupported() { return true; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.onstop?.(); }
    requestData() {}
  }
  const input = createDeviceInput({
    media: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) }, MediaRecorder: Recorder },
    transcribe: async () => "",
    onPhase: (phase: string) => { if (phase === "recording") opened(); },
  });
  const pending = input.capture({ continuous: false });
  await ready;
  input.stop();
  await assert.rejects(pending, (error: Error) => error.message === "voice_too_short");
});

test("single recordings wait for manual stop while continuous turns use endpointing", async () => {
  const { createDeviceInput } = await import("@olares/lares-core/voice/device-input");
  for (const continuous of [false, true]) {
    let endpoints = 0;
    let opened = () => {};
    const ready = new Promise<void>((resolve) => { opened = resolve; });
    class Recorder {
      state = "inactive";
      mimeType = "audio/webm";
      static isTypeSupported() { return true; }
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; }
      requestData() {}
    }
    const input = createDeviceInput({
      media: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) }, MediaRecorder: Recorder },
      transcribe: async () => "test",
      endpoint: () => { endpoints++; return { stop() {} }; },
      onPhase: (phase: string) => { if (phase === "recording") opened(); },
    });
    const pending = input.capture({ continuous });
    await ready;
    try { assert.equal(endpoints, continuous ? 1 : 0); }
    finally { input.cancel(); await pending; }
  }
});

test("a committed take is not transcribed a second time from its recording", async () => {
  const { createVoiceCapture } = await import("@olares/lares-core/voice/browser-capture");
  let uploads = 0;
  let phase = "idle";
  class Recorder {
    state = "inactive";
    mimeType = "audio/webm";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    static isTypeSupported() { return true; }
    start() { this.state = "recording"; this.ondataavailable?.({ data: new Blob([new Uint8Array(2048)]) }); }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob([new Uint8Array(2048)]) }); this.onstop?.(); }
    requestData() {}
  }
  const capture = createVoiceCapture({
    media: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) }, MediaRecorder: Recorder },
    transcribe: async () => { uploads += 1; return "uploaded"; },
    streamInput: () => ({ committed: true, replayable: false, async finish() { throw new Error("voice_asr_timeout"); }, cancel() {} }),
    onPhase: (next: string) => { phase = next; },
  });
  await capture.start();
  for (let i = 0; i < 100 && phase !== "recording"; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  await new Promise((resolve) => setTimeout(resolve, 750));
  capture.stop();
  for (let i = 0; i < 100 && phase !== "error"; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(uploads, 0);
  assert.equal(phase, "error");
  capture.dispose();
});
