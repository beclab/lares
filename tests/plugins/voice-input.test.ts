import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VoiceError, classifyFailure, isSttModel, isTtsModel, pickSttModelId, retryable } from "@olares/lares-core/router/stt";
import { reduceUtterance } from "@olares/lares-core/voice/speech";
import { speechScript } from "@olares/lares-core/voice/script";
import { postTranscribe } from "@olares/lares-core/voice/client";
import { frameHasAudio, isRecordingTooShort, openRecordingStream, pickInputDevice } from "@olares/lares-core/voice/recorder";
import {
  EMPTY_VOICE_CONFIG,
  STT_LANGUAGE_CHOICES,
  voiceLanguageItems,
  voiceMenuValue,
  voiceModelItems,
  voiceValueFromMenu,
} from "@olares/lares-core/voice/languages";

test("a take is too short when it is only a container header", () => {
  assert.equal(isRecordingTooShort(699, 2048), true);
  assert.equal(isRecordingTooShort(800, 1023), true);
  assert.equal(isRecordingTooShort(800, 1024), false);
});

test("recording opens the headset Chrome lists, not the silent Default input", async () => {
  const devices = [
    { kind: "audioinput", deviceId: "default", label: "Default" },
    { kind: "audioinput", deviceId: "dolphin", label: "Dolphin520" },
    { kind: "audiooutput", deviceId: "out", label: "Dolphin520" },
  ];
  assert.equal(pickInputDevice(devices, "Dolphin520"), "dolphin");
  assert.equal(pickInputDevice(devices, ""), "");
  assert.equal(pickInputDevice(devices, "Missing"), "");

  const calls: { audio: Record<string, unknown> }[] = [];
  const media = {
    async enumerateDevices() {
      return devices;
    },
    async getUserMedia(constraints: { audio: Record<string, unknown> }) {
      calls.push(constraints);
      return { getTracks: () => [] };
    },
  };
  await openRecordingStream({ label: "Dolphin520" }, media as never);
  await openRecordingStream({}, media as never);
  assert.equal(calls[0].audio.deviceId && (calls[0].audio.deviceId as { exact: string }).exact, "dolphin");
  assert.equal("deviceId" in calls[1].audio, false);
});

test("the headset link is audible only after the opening silence ends", () => {
  assert.equal(frameHasAudio(new Float32Array(4096)), false);
  const live = new Float32Array(8);
  live[3] = 0.001;
  assert.equal(frameHasAudio(live), true);
});

test("voice settings map the auto sentinel to an empty stored value", () => {
  assert.equal(voiceMenuValue(""), "auto");
  assert.equal(voiceValueFromMenu("auto"), "");
  assert.equal(voiceValueFromMenu("zh"), "zh");
  assert.deepEqual(STT_LANGUAGE_CHOICES.map((item) => item.id), ["zh", "en", "ja", "ko"]);
  assert.deepEqual(EMPTY_VOICE_CONFIG, { model: "", ttsModel: "", language: "", speak: false, streaming: false });
  assert.equal(voiceLanguageItems("Auto")[0].label, "Auto");
  assert.deepEqual(voiceModelItems(["whisper-a"], "Auto"), [
    { id: "auto", label: "Auto" },
    { id: "whisper-a", label: "whisper-a" },
  ]);
});

test("postTranscribe posts the blob to the Host voice URL", async () => {
  const original = globalThis.fetch;
  const calls: { url: string; type: string }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), type: String((init?.headers as Record<string, string>)?.["content-type"] ?? "") });
    return new Response(JSON.stringify({ text: "你好" }), { status: 200 });
  }) as typeof fetch;
  try {
    const blob = new Blob(["xxxx"], { type: "audio/webm" });
    assert.equal(
      await postTranscribe(blob, "zh", undefined, { baseUrl: "/laresHost/api/lares/voice" }),
      "你好",
    );
    assert.deepEqual(calls, [{ url: "/laresHost/api/lares/voice/transcribe?language=zh", type: "audio/webm" }]);
  } finally {
    globalThis.fetch = original;
  }
});

test("speech playback keeps only the text that survives the last tool call", () => {
  let state = null;
  const steps = [
    { type: "turn/start", data: { turn: 1 } },
    { type: "assistant/message", data: { turn: 1, step: 0, message: { content: [{ type: "reasoning", text: "thinking" }, { type: "text", text: "I will look that up." }, { type: "tool-call", callId: "c1", name: "search", arguments: "{}" }] } } },
    { type: "tool/call", data: { turn: 1, name: "search" } },
    { type: "assistant/message", data: { turn: 1, step: 1, message: { content: [{ type: "text", text: "The answer is ready." }] } } },
    { type: "turn/end", data: { turn: 1 } },
  ];
  for (const event of steps) state = reduceUtterance(state, event);
  assert.equal(state?.text, "The answer is ready.");
  assert.equal(state?.silent, false);
  assert.equal(speechScript("See `docs` and ```\ncode\n``` please."), "See docs and please.");
});

test("speech script keeps abbreviations and decimals inside the sentence", () => {
  assert.equal(
    speechScript("Pi is 3.14. **Done!** Next?\nYes"),
    "Pi is 3.14.\nDone!\nNext?\nYes",
  );
  assert.equal(
    speechScript("Mr. Smith left the U.S. He went home."),
    "Mr. Smith left the U.S.\nHe went home.",
  );
  assert.equal(speechScript("See e.g. this. It works."), "See e.g. this.\nIt works.");
});

test("recognition includes flagged models whose names are not whisper-like", () => {
  assert.equal(isSttModel({ id: "parakeet/nvidia/parakeet-unified-en-0.6b", mode: "audio", supportsStt: true }), true);
  assert.equal(isTtsModel({ id: "kokoro/hexgrad/Kokoro-82M", mode: "tts", supportsTts: true }), true);
  assert.equal(isTtsModel({ id: "parakeet/nvidia/parakeet-unified-en-0.6b", mode: "audio", supportsStt: true }), false);
});

test("install requests the catalog chart for that kind", async () => {
  const { installVoiceChart } = await import(`../../packages/core/voice/install.js?install=${Date.now()}`);
  const calls: string[][] = [];
  const spawnFn = ((_cmd: string, args: string[]) => {
    calls.push(args);
    return {
      stdout: { on(_event: string, listener: (chunk: string) => void) { listener('{"status":"accepted"}'); } },
      stderr: { on() {} },
      on(event: string, listener: (code?: number) => void) {
        if (event === "close") listener(0);
      },
    };
  }) as unknown as typeof import("node:child_process").spawn;
  const installed = await installVoiceChart("tts", { spawnFn });
  assert.equal(installed.app, "audioqwen3tts06v3");
  assert.deepEqual(calls[0], [
    "market", "install", "audioqwen3tts06v3", "-s", "market.test", "--compute-mode", "nvidia", "-o", "json",
  ]);
  assert.equal(calls[0].includes("--version"), false);
});

test("GPU switch keeps each app's memory slice across a time-slice round trip", async () => {
  const home = mkdtempSync(join(tmpdir(), "lares-gpu-"));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const GiB = 2 ** 30;
  const device: { bindings: { appName: string; memory: number }[]; [key: string]: unknown } = {
    id: "GPU-1",
    nodeName: "demo01",
    mode: "nvidia",
    supportType: "MemorySlice",
    availableSupportTypes: ["TimeSlice", "MemorySlice"],
    bindings: [
      { appName: "sglang", memory: 15 * GiB },
      { appName: "audioqwen3tts06v3", memory: 4 * GiB },
      { appName: "audioqwen3asr06v3", memory: 3.5 * GiB },
    ],
  };
  const calls: string[][] = [];
  const spawnFn = ((_cmd: string, args: string[]) => {
    calls.push(args);
    if (args[2] === "set-type") {
      device.supportType = args[args.indexOf("--type") + 1];
      device.bindings = [];
    }
    const body = args[2] === "list"
      ? JSON.stringify([{ devices: [device] }])
      : args[1] === "list" ? "[]" : '{"status":"success"}';
    return {
      stdout: { on(_event: string, listener: (chunk: string) => void) { listener(body); } },
      stderr: { on() {} },
      on(event: string, listener: (code?: number) => void) {
        if (event === "close") setTimeout(() => listener(0), 0);
      },
    };
  }) as unknown as typeof import("node:child_process").spawn;
  const settle = async (gpuSwitchJob: () => { phase: string } | null) => {
    while (["switching", "resuming"].includes(gpuSwitchJob()?.phase ?? "")) await new Promise((r) => setTimeout(r, 1));
    return gpuSwitchJob();
  };
  try {
    const { gpuSwitchJob, switchReadingMode } = await import(`../../packages/core/voice/gpu-mode.js?rt=${Date.now()}`);
    const { readConfig } = await import(`../../packages/core/voice/config.js?rt=${Date.now()}`);
    const off = await switchReadingMode(false, { spawnFn });
    assert.equal(off.streaming, false);
    assert.equal((await settle(gpuSwitchJob))?.phase, "done");
    assert.deepEqual(calls.filter((args) => args[1] === "stop").map((args) => args[2]), [
      "sglang", "audioqwen3tts06v3", "audioqwen3asr06v3",
    ]);
    assert.ok(calls.findIndex((args) => args[1] === "stop") < calls.findIndex((args) => args[2] === "set-type"));
    assert.deepEqual(calls.find((args) => args[2] === "set-type"), [
      "settings", "compute", "set-type", "demo01", "GPU-1", "--type", "TimeSlice", "--yes", "-o", "json",
    ]);
    const resumes = () => calls.filter((args) => args[1] === "resume").map((args) => [args[2], args[args.indexOf("--compute-binding") + 1]]);
    assert.deepEqual(resumes(), [
      ["audioqwen3asr06v3", "demo01:GPU-1"],
      ["audioqwen3tts06v3", "demo01:GPU-1"],
      ["sglang", "demo01:GPU-1"],
    ]);
    calls.length = 0;
    await switchReadingMode(true, { spawnFn });
    assert.equal((await settle(gpuSwitchJob))?.phase, "done");
    assert.equal(readConfig().streaming, true);
    assert.deepEqual(resumes(), [
      ["audioqwen3asr06v3", "demo01:GPU-1:3584Mi"],
      ["audioqwen3tts06v3", "demo01:GPU-1:4096Mi"],
      ["sglang", "demo01:GPU-1:15360Mi"],
    ]);
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
});

test("saving a slice plan while memory-sliced restarts only the apps that changed", async () => {
  const home = mkdtempSync(join(tmpdir(), "lares-plan-"));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const GiB = 2 ** 30;
  const device = {
    id: "GPU-1",
    nodeName: "demo01",
    mode: "nvidia",
    memory: 24 * GiB,
    supportType: "MemorySlice",
    availableSupportTypes: ["TimeSlice", "MemorySlice"],
    bindings: [
      { appName: "sglang", memory: 15 * GiB },
      { appName: "audioqwen3tts06v3", memory: 4 * GiB },
      { appName: "audioqwen3asr06v3", memory: 3.5 * GiB },
    ],
  };
  const calls: string[][] = [];
  const spawnFn = ((_cmd: string, args: string[]) => {
    calls.push(args);
    const body = args[2] === "list"
      ? JSON.stringify([{ devices: [device] }])
      : args[1] === "list" ? "[]" : '{"status":"success"}';
    return {
      stdout: { on(_event: string, listener: (chunk: string) => void) { listener(body); } },
      stderr: { on() {} },
      on(event: string, listener: (code?: number) => void) {
        if (event === "close") setTimeout(() => listener(0), 0);
      },
    };
  }) as unknown as typeof import("node:child_process").spawn;
  try {
    const { gpuSwitchJob, saveSlicePlan } = await import(`../../packages/core/voice/gpu-mode.js?plan=${Date.now()}`);
    await assert.rejects(
      saveSlicePlan([{ app: "sglang", enabled: true, memory: 30 * GiB }], { spawnFn }),
      (err: { status?: number }) => err.status === 400,
    );
    const payload = await saveSlicePlan([
      { app: "sglang", enabled: true, memory: 15 * GiB },
      { app: "audioqwen3tts06v3", enabled: true, memory: 5 * GiB },
      { app: "audioqwen3asr06v3", enabled: false, memory: 3.5 * GiB },
    ], { spawnFn });
    assert.deepEqual(payload.plan.map((entry: { app: string; kind: string }) => [entry.app, entry.kind]), [
      ["sglang", ""], ["audioqwen3tts06v3", "tts"], ["audioqwen3asr06v3", "stt"],
    ]);
    while (["switching", "resuming"].includes(gpuSwitchJob()?.phase ?? "")) await new Promise((r) => setTimeout(r, 1));
    assert.equal(gpuSwitchJob()?.phase, "done");
    const ops = calls.filter((args) => args[2] !== "list" && args[1] !== "list").map((args) => `${args[1] === "compute" ? args[2] : args[1]} ${args[1] === "compute" ? args[3] : args[2]}`);
    assert.deepEqual(ops, [
      "stop audioqwen3tts06v3", "unbind audioqwen3tts06v3",
      "stop audioqwen3asr06v3", "unbind audioqwen3asr06v3",
      "resume audioqwen3tts06v3",
    ]);
    const resume = calls.find((args) => args[1] === "resume");
    assert.equal(resume?.[resume.indexOf("--compute-binding") + 1], "demo01:GPU-1:5120Mi");
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
});

type CliReply = { body?: string; code?: number };

function fakeCli(reply: (args: string[]) => CliReply, calls: string[][] = []) {
  return ((_cmd: string, args: string[]) => {
    calls.push(args);
    const { body = '{"status":"success"}', code = 0 } = reply(args);
    return {
      stdout: { on(_event: string, listener: (chunk: string) => void) { listener(body); } },
      stderr: { on() {} },
      on(event: string, listener: (code?: number) => void) {
        if (event === "close") setTimeout(() => listener(code), 0);
      },
    };
  }) as unknown as typeof import("node:child_process").spawn;
}

async function withGpuHome<T>(run: (home: string) => Promise<T>) {
  const home = mkdtempSync(join(tmpdir(), "lares-gpu-"));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    return await run(home);
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
}

const GPU_GiB = 2 ** 30;

/** A time-sliced 24 GiB card with three running GPU apps and one stopped. */
function timeSlicedCard(required: Record<string, string>) {
  const device = {
    id: "GPU-1",
    nodeName: "demo01",
    mode: "nvidia",
    memory: 24 * GPU_GiB,
    supportType: "TimeSlice",
    availableSupportTypes: ["TimeSlice", "MemorySlice"],
    bindings: Object.keys(required).map((appName) => ({ appName, memory: 0 })),
  };
  const mine = Object.keys(required).map((name) => ({
    name, title: name, source: "upload", state: name === "flowstudio" ? "stopped" : "running",
  }));
  const reply = (args: string[]): CliReply | null => {
    if (args[2] === "list") return { body: JSON.stringify([{ devices: [device] }]) };
    if (args[1] === "list") return { body: JSON.stringify(mine) };
    if (args[1] === "get") {
      return { body: JSON.stringify({ app_info: { app_entry: { accelerator: [{ mode: "nvidia", requiredGPUMemory: required[args[2]] }] } } }) };
    }
    return null;
  };
  return { device, reply };
}

async function settleJob(gpuSwitchJob: () => { phase: string } | null) {
  while (["switching", "restoring", "resuming"].includes(gpuSwitchJob()?.phase ?? "")) {
    await new Promise((r) => setTimeout(r, 1));
  }
  return gpuSwitchJob();
}

test("a first switch to memory slicing gives each running app its minimum", async () => {
  await withGpuHome(async () => {
    const card = timeSlicedCard({ audioqwen3asr06v3: "3584Mi", audioqwen3tts06v3: "4Gi", sglang: "15Gi", flowstudio: "6Gi" });
    const calls: string[][] = [];
    const spawnFn = fakeCli((args) => card.reply(args) ?? {}, calls);
    const { gpuSwitchJob, switchReadingMode } = await import(`../../packages/core/voice/gpu-mode.js?seed=${Date.now()}`);
    const { readConfig } = await import(`../../packages/core/voice/config.js?seed=${Date.now()}`);
    await switchReadingMode(true, { spawnFn });
    assert.equal((await settleJob(gpuSwitchJob))?.phase, "done");
    assert.equal(readConfig().streaming, true);
    const resumes = calls.filter((args) => args[1] === "resume").map((args) => [args[2], args[args.indexOf("--compute-binding") + 1]]);
    assert.deepEqual(resumes, [
      ["audioqwen3asr06v3", "demo01:GPU-1:3584Mi"],
      ["audioqwen3tts06v3", "demo01:GPU-1:4096Mi"],
      ["sglang", "demo01:GPU-1:15360Mi"],
    ]);
  });
});

test("a memory-slice plan that cannot fit is refused before any app stops", async () => {
  await withGpuHome(async () => {
    const card = timeSlicedCard({ audioqwen3asr06v3: "6Gi", audioqwen3tts06v3: "4Gi", sglang: "15Gi" });
    const calls: string[][] = [];
    const spawnFn = fakeCli((args) => card.reply(args) ?? {}, calls);
    const { gpuSwitchJob, switchReadingMode } = await import(`../../packages/core/voice/gpu-mode.js?over=${Date.now()}`);
    const { readConfig } = await import(`../../packages/core/voice/config.js?over=${Date.now()}`);
    await switchReadingMode(true, { spawnFn });
    const job = await settleJob(gpuSwitchJob);
    assert.equal(job?.phase, "failed");
    assert.deepEqual(job?.problem, { code: "voice_gpu_plan_over", params: { need: 25, total: 24 }, detail: "" });
    assert.equal(calls.some((args) => ["stop", "resume", "set-type"].includes(args[1] === "compute" ? args[2] : args[1])), false);
    assert.equal(readConfig().streaming, false);
  });
});

test("a refused GPU switch puts the stopped apps back and keeps the reading mode", async () => {
  await withGpuHome(async () => {
    const card = timeSlicedCard({ audioqwen3asr06v3: "3584Mi", sglang: "15Gi" });
    const calls: string[][] = [];
    const spawnFn = fakeCli((args) => {
      if (args[2] === "set-type") return { code: 1, body: '{"status":"failed","message":"API error (HTTP 403): forbidden"}' };
      return card.reply(args) ?? {};
    }, calls);
    const { gpuSwitchJob, switchReadingMode } = await import(`../../packages/core/voice/gpu-mode.js?refused=${Date.now()}`);
    const { readConfig } = await import(`../../packages/core/voice/config.js?refused=${Date.now()}`);
    await switchReadingMode(true, { spawnFn });
    const job = await settleJob(gpuSwitchJob) as { phase: string; problem: { code: string }; restored: { app: string; ok: boolean }[] };
    assert.equal(job.phase, "failed");
    assert.equal(job.problem.code, "voice_gpu_forbidden");
    assert.deepEqual(job.restored, [{ app: "audioqwen3asr06v3", ok: true }, { app: "sglang", ok: true }]);
    const resumes = calls.filter((args) => args[1] === "resume").map((args) => [args[2], args[args.indexOf("--compute-binding") + 1]]);
    assert.deepEqual(resumes, [["audioqwen3asr06v3", "demo01:GPU-1"], ["sglang", "demo01:GPU-1"]]);
    assert.equal(readConfig().streaming, false);
  });
});

test("GPU problems read as guidance in both languages", async () => {
  const { cliProblem, gpuProblemText } = await import("@olares/lares-core/voice/gpu-problem");
  const { ZH, EN } = await import("@olares/lares-core/i18n/voice");
  const { interpolate } = await import("@olares/lares-core/i18n/t");
  assert.equal(cliProblem({ message: "API error (HTTP 403): forbidden" }, "voice_gpu_failed").code, "voice_gpu_forbidden");
  assert.equal(cliProblem({ message: "credential is invalidated, run profile login" }, "voice_gpu_failed").code, "voice_gpu_login");
  assert.equal(cliProblem({ message: "bound-apps-stop-blocked: sglang" }, "voice_gpu_failed").code, "voice_gpu_blocked");
  assert.equal(cliProblem({ message: "insufficient GPU memory on node" }, "voice_gpu_resume_failed", { app: "a" }).code, "voice_gpu_memory");
  assert.equal(cliProblem({ message: "boom" }, "voice_gpu_stop_failed", { app: "a" }).code, "voice_gpu_stop_failed");

  const zhKeys = Object.keys(ZH).filter((key) => key.startsWith("error.voice_gpu_") || key.startsWith("settings.mode."));
  const enKeys = Object.keys(EN).filter((key) => key.startsWith("error.voice_gpu_") || key.startsWith("settings.mode."));
  assert.deepEqual(enKeys.sort(), zhKeys.sort());

  const translate = (table: Record<string, string>) => (key: string, params?: Record<string, unknown>) =>
    table[key] === undefined ? key : interpolate(table[key], params);
  assert.equal(
    gpuProblemText(translate(ZH), { code: "voice_gpu_resume_failed", params: { app: "语音识别" }, detail: "timeout" }),
    "语音识别没能启动（timeout）。请在 Olares 市场查看它的状态，再点重试",
  );
  assert.match(gpuProblemText(translate(EN), { code: "voice_gpu_new_thing", params: {}, detail: "oops" }), /^Couldn't switch the GPU mode \(oops\)/);
});

test("chart status reads the live row across every market source", async () => {
  const { currentChartRow, voiceChartStatus } = await import(`../../packages/core/voice/install.js?rows=${Date.now()}`);
  const rows = [
    { name: "audioqwen3asr06v3", state: "uninstalled", source: "market.test", statusTime: "2026-10-14T13:19:35Z" },
    { name: "audioqwen3asr06v3", state: "running", source: "upload", statusTime: "2026-10-15T03:00:38Z" },
    { name: "audioqwen3asr06v3", state: "stopped", source: "market.olares", statusTime: "2026-10-13T00:00:00Z" },
  ];
  assert.equal(currentChartRow(rows)?.source, "upload");
  assert.equal(currentChartRow([rows[0]])?.state, "uninstalled");
  assert.equal(currentChartRow({ state: "stopped" })?.state, "stopped");
  const spawnFn = (() => ({
    stdout: { on(_event: string, listener: (chunk: string) => void) { listener(JSON.stringify(rows)); } },
    stderr: { on() {} },
    on(event: string, listener: (code?: number) => void) {
      if (event === "close") listener(0);
    },
  })) as unknown as typeof import("node:child_process").spawn;
  assert.equal((await voiceChartStatus("stt", { spawnFn })).phase, "running");
});

test("GPU apps come from every source, read from the source each was installed from", async () => {
  const { gpuApps, parseQuantity } = await import(`../../packages/core/voice/gpu-mode.js?apps=${Date.now()}`);
  assert.equal(parseQuantity("6Gi"), 6 * 2 ** 30);
  assert.equal(parseQuantity("512Mi"), 512 * 2 ** 20);
  assert.equal(parseQuantity(undefined), 0);
  const calls: string[][] = [];
  const spawnFn = ((_cmd: string, args: string[]) => {
    calls.push(args);
    let body = "";
    if (args[1] === "list") {
      body = JSON.stringify([
        { name: "flowstudio", title: "FlowStudio", source: "market.olares", state: "stopped" },
        { name: "router", title: "Router", source: "market.olares", state: "running" },
        { name: "sglang", title: "Qwen (SGLang)", source: "upload", state: "running" },
      ]);
    } else {
      const gpu = { flowstudio: "6Gi", sglang: "15Gi" }[args[2] as "flowstudio" | "sglang"];
      body = JSON.stringify({ app_info: { app_entry: { accelerator: gpu ? [{ mode: "nvidia", requiredGPUMemory: gpu }] : [] } } });
    }
    return {
      stdout: { on(_event: string, listener: (chunk: string) => void) { listener(body); } },
      stderr: { on() {} },
      on(event: string, listener: (code?: number) => void) {
        if (event === "close") listener(0);
      },
    };
  }) as unknown as typeof import("node:child_process").spawn;
  assert.deepEqual(await gpuApps({ spawnFn }), [
    { app: "flowstudio", title: "FlowStudio", source: "market.olares", phase: "stopped", required: 6 * 2 ** 30 },
    { app: "sglang", title: "Qwen (SGLang)", source: "upload", phase: "running", required: 15 * 2 ** 30 },
  ]);
  assert.deepEqual(calls.find((args) => args[2] === "sglang"), ["market", "get", "sglang", "-s", "upload", "-o", "json"]);
});

test("starting a GPU app that is already running counts as started", async () => {
  const home = mkdtempSync(join(tmpdir(), "lares-app-"));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const device = { id: "GPU-1", nodeName: "demo01", mode: "nvidia", supportType: "TimeSlice", availableSupportTypes: ["TimeSlice"], bindings: [] };
  const spawnFn = ((_cmd: string, args: string[]) => {
    let body = '{"status":"success"}';
    let code = 0;
    if (args[2] === "list") body = JSON.stringify([{ devices: [device] }]);
    else if (args[1] === "list") body = JSON.stringify([{ name: "flowstudio", title: "FlowStudio", source: "market.olares", state: "running" }]);
    else if (args[1] === "get") body = JSON.stringify({ app_info: { app_entry: { accelerator: [{ mode: "nvidia", requiredGPUMemory: "6Gi" }] } } });
    else if (args[1] === "status") body = JSON.stringify([{ name: "flowstudio", state: "running", statusTime: "2026-10-15T03:48:19Z" }]);
    else if (args[1] === "resume") {
      body = '{"status":"failed","message":"API error (HTTP 404): App not found or current state does not allow operation"}';
      code = 1;
    }
    return {
      stdout: { on(_event: string, listener: (chunk: string) => void) { listener(body); } },
      stderr: { on() {} },
      on(event: string, listener: (code?: number) => void) {
        if (event === "close") setTimeout(() => listener(code), 0);
      },
    };
  }) as unknown as typeof import("node:child_process").spawn;
  try {
    const { gpuAppAction, gpuModePayload } = await import(`../../packages/core/voice/gpu-mode.js?started=${Date.now()}`);
    await gpuAppAction("flowstudio", "resume", { spawnFn });
    let payload = await gpuModePayload({ spawnFn });
    while (payload.apps[0]?.pending) {
      await new Promise((r) => setTimeout(r, 2));
      payload = await gpuModePayload({ spawnFn });
    }
    assert.equal(payload.apps[0]?.problem, null);
    const { readJsonFile } = await import("@olares/lares-core/tools/json-file");
    assert.deepEqual(readJsonFile(join(home, "voice-gpu", "config.json"))?.apps, ["flowstudio"]);
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
});

test("chart phase follows the market row", async () => {
  const { chartPhase, chartModelId, stopVoiceChart } = await import(
    `../../packages/core/voice/install.js?phase=${Date.now()}`
  );
  assert.equal(chartPhase(null), "absent");
  assert.equal(chartPhase({ status: "failed", message: "not installed" }), "absent");
  assert.equal(chartPhase({ state: "downloading" }), "busy");
  assert.equal(chartPhase({ state: "running" }), "running");
  assert.equal(chartPhase({ state: "stopped" }), "stopped");
  assert.equal(chartModelId("stt", ["parakeet/x", "audioqwen3asr06v3/Qwen/Qwen3-ASR-0.6B"]), "audioqwen3asr06v3/Qwen/Qwen3-ASR-0.6B");

  const calls: string[][] = [];
  const spawnFn = ((_cmd: string, args: string[]) => {
    calls.push(args);
    const body = args[1] === "status" ? '{"state":"stopped"}' : '{"status":"success","finalState":"stopped"}';
    return {
      stdout: { on(_event: string, listener: (chunk: string) => void) { listener(body); } },
      stderr: { on() {} },
      on(event: string, listener: (code?: number) => void) {
        if (event === "close") listener(0);
      },
    };
  }) as unknown as typeof import("node:child_process").spawn;
  const stopped = await stopVoiceChart("stt", { spawnFn });
  assert.equal(stopped.phase, "stopped");
  assert.deepEqual(calls[0]?.slice(0, 3), ["market", "stop", "audioqwen3asr06v3"]);
  assert.ok(calls[0]?.includes("--watch"));
});

test("probe treats an engine answer as connected and a stopped chart as not", async () => {
  const { probeVoice } = await import(`../../packages/core/voice/service.js?probe=${Date.now()}`);
  const reached = await probeVoice("stt", {
    status: async () => ({ app: "audioqwen3asr06v3", phase: "running" }),
    listModels: async () => [{ id: "audioqwen3asr06v3/Qwen/Qwen3-ASR-0.6B", supportsStt: true }],
    transcribe: async () => {
      throw new VoiceError("voice_audio_unreadable", 400, "no speech");
    },
  });
  assert.equal(reached.ok, true);
  await assert.rejects(
    () => probeVoice("tts", {
      status: async () => ({ app: "audioqwen3tts06v3", phase: "stopped" }),
    }),
    (err) => err instanceof VoiceError && err.code === "voice_probe_failed",
  );
});

test("pickSttModelId honors a listed preference, else the first whisper/stt row", () => {
  const catalog = [
    { id: "Qwen3.6-27B (llama.cpp)/x", mode: "chat" },
    { id: "Olares/mispeech/Dasheng-AudioGen", mode: "audio" },
    { id: "Whisper Large V3 (FW) X3/openai/whisper-large-v3", mode: "audio" },
    { id: "EmbeddingGemma/embeddinggemma-300m", mode: "embedding" },
  ];
  assert.equal(pickSttModelId(catalog), catalog[2].id);
  assert.equal(pickSttModelId(catalog, catalog[2].id), catalog[2].id);
  assert.equal(pickSttModelId(catalog, catalog[0].id), catalog[2].id);
  assert.equal(pickSttModelId([{ id: "Qwen/chat", mode: "chat" }]), null);
});

test("classifyFailure separates undecodable audio from transient upstream", () => {
  assert.equal(classifyFailure(422, "unknown file extension"), "voice_audio_unreadable");
  assert.equal(classifyFailure(500, "moov atom not found"), "voice_audio_unreadable");
  assert.equal(classifyFailure(404, "no such model"), "voice_model_unavailable");
  assert.equal(classifyFailure(503, "backend restarting"), "voice_failed");
});

test("retryable covers cold-start / restart statuses only", () => {
  for (const status of [429, 500, 502, 503, 504]) assert.equal(retryable(status), true);
  for (const status of [400, 401, 404, 422]) assert.equal(retryable(status), false);
});

test("listModels reuses a live catalog until refresh", async () => {
  let fetches = 0;
  const originalFetch = globalThis.fetch;
  const { catalogCache } = await import("../../packages/core/router/catalog-cache.js");
  catalogCache.reset();
  globalThis.fetch = async () => {
    fetches += 1;
    return new Response(JSON.stringify({ data: [{ id: "whisper-a", mode: "audio" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const { forgetSttModel, listModels } = await import(
      `../../packages/core/router/stt.js?catalog=${Date.now()}`
    );
    forgetSttModel();
    await Promise.all([listModels(), listModels()]);
    assert.equal(fetches, 1);
    await listModels();
    assert.equal(fetches, 1);
    await listModels({ refresh: true });
    assert.equal(fetches, 2);
  } finally {
    globalThis.fetch = originalFetch;
    catalogCache.reset();
  }
});

test("resolved STT cache is keyed by the configured preference", async () => {
  const originalFetch = globalThis.fetch;
  const { catalogCache } = await import("../../packages/core/router/catalog-cache.js");
  catalogCache.reset();
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          { id: "whisper-a", mode: "audio" },
          { id: "whisper-b", mode: "audio" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  try {
    const { forgetSttModel, resolveSttModel } = await import(
      `../../packages/core/router/stt.js?cache=${Date.now()}`
    );
    forgetSttModel();
    assert.equal(await resolveSttModel("whisper-a"), "whisper-a");
    assert.equal(await resolveSttModel("whisper-b"), "whisper-b");
  } finally {
    globalThis.fetch = originalFetch;
    catalogCache.reset();
  }
});

test("readConfig / writeConfig round-trip through DSH_HOME", async () => {
  const home = mkdtempSync(join(tmpdir(), "lares-voice-"));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { readConfig, spokenReplyPrompt, validateConfigPatch, writeConfig } = await import(
      `../../packages/core/voice/config.js?cfg=${Date.now()}`
    );
    assert.deepEqual(readConfig(), { model: "", ttsModel: "", language: "", speak: false, streaming: false });
    assert.equal(spokenReplyPrompt(), "");
    const saved = writeConfig({ model: "  whisper-x  ", language: "zh" });
    assert.equal(saved.model, "whisper-x");
    assert.equal(saved.language, "zh");
    assert.equal(writeConfig({ speak: true, ttsModel: "kokoro/hexgrad/Kokoro-82M" }).speak, true);
    assert.match(spokenReplyPrompt(), /read aloud/);
    assert.equal(readConfig().model, "whisper-x");
    assert.equal(writeConfig({ streaming: true }).streaming, true);
    for (const patch of [
      { streaming: "yes" },
      { ignored: "value" },
      { language: "zh\r\nX-Injected: yes" },
      { language: "fr" },
      { model: "whisper\r\nX-Injected: yes" },
      { model: 42 },
      [],
      null,
    ]) {
      assert.throws(
        () => validateConfigPatch(patch),
        (err: { code?: string; status?: number }) =>
          err.code === "voice_config_invalid" && err.status === 400,
      );
    }
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
});
