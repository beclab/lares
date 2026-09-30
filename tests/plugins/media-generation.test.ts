import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MEDIA_SETTLED_EVENT,
  MEDIA_SUBMITTED_EVENT,
  MediaGenerationError,
  PASS_CHECK_IMAGE,
  awaitMediaGeneration,
  errorText,
  generationFailure,
  mediaGenerationRequest,
  pendingMediaGenerations,
  recoverMediaGenerations,
  recoveredGenerationsNote,
  runMediaGeneration,
  submitMediaGeneration,
} from "@olares/lares-core/media/generation";
import { mediaGenerateDefinition } from "@olares/lares-core/media/tool";
import { bindParams, planGeneration, rowContract } from "../../packages/core/media/catalog-row.js";
import { publishedPathsFromToolCall } from "@olares/lares-core/files/published-tools";
import { installMediaRecovery } from "../../packages/web/workspace-artifacts/host/index.js";

const env = { LLM_GATEWAY_URL: "http://router.test/v1", OLARES_USERNAME: "alice" };

// Router's catalog as the tool reads it: the row, not the tool, says what a call needs.
const CATALOG = [
  {
    id: "flowstudio/abc",
    mode: "video_generation",
    name: "图生视频",
    flowstudio: {
      needs_reference: true,
      parameters: [
        { key: "seed", label: "Seed", type: "int" },
        { key: "fps", label: "帧率", type: "number", min: 8, max: 30, default: 24 },
      ],
    },
  },
  {
    id: "flowstudio/edit",
    mode: "image_generation",
    name: "图片编辑",
    creative: { operations: ["edit"] },
    canonical_fields: ["inputs.images", "inputs.mask"],
    flowstudio: {
      needs_reference: true,
      parameters: [
        { key: "strength", label: "重绘强度", type: "number", min: 0, max: 1 },
        { key: "style", label: "风格", type: "select", options: [{ value: "anime", label: "动漫" }, { value: "real", label: "写实" }] },
      ],
    },
  },
  { id: "flowstudio/i2v", mode: "video_generation", name: "I2V", flowstudio: { needs_reference: true, parameters: [] } },
  { id: "flowstudio/t2v", mode: "video_generation", name: "T2V", flowstudio: { needs_reference: false, parameters: [] } },
  {
    id: "Olares/0509fbae-14cc-4932-9b09-0337e92ebab6",
    mode: "image_generation",
    name: "Qwen-Image · Text to Image",
    creative: { operations: ["generate"] },
    canonical_fields: ["seed", "prompt", "n"],
    flowstudio: {
      parameters: [
        { key: "text", label: "Prompt", type: "textarea", associateRole: "prompt", required: true },
        { key: "megapixels", label: "Megapixels", type: "select", options: [{ label: "720p", value: "0.92" }] },
      ],
    },
  },
  { id: "openai/gpt-image", mode: "image_generation", creative: { operations: ["generate", "edit"] } },
  { id: "a/b", mode: "image_generation" },
  { id: "q/chat", mode: "chat" },
];
const row = (id: string) => rowContract(CATALOG.find((item) => item.id === id));

type Reply = { status?: number; body?: unknown; headers?: Record<string, string>; bytes?: Buffer };

function fakeFetch(routes: Record<string, Reply[] | Reply>) {
  const calls: { url: string; init: any }[] = [];
  const fetch = async (url: string, init: any = {}) => {
    calls.push({ url, init });
    const key = `${(init.method ?? "GET").toUpperCase()} ${url.replace("http://router.test/v1", "")}`;
    const entry = routes[key] ?? (key === "GET /models?detail=capabilities" ? { body: { data: CATALOG } } : undefined);
    const reply = Array.isArray(entry) ? entry.shift() : entry;
    if (!reply) throw new Error(`unexpected ${key}`);
    const headers = new Headers(reply.headers ?? { "content-type": "application/json" });
    const text = reply.bytes ? "" : JSON.stringify(reply.body ?? {});
    return {
      ok: (reply.status ?? 200) < 300,
      status: reply.status ?? 200,
      headers,
      text: async () => text,
      arrayBuffer: async () => reply.bytes ?? Buffer.from(text),
    };
  };
  return { fetch, calls };
}

function recordingSession(events: any[] = []) {
  return {
    events,
    append(type: string, data: any) {
      events.push({ type, data });
    },
  };
}

const noSleep = async () => {};

test("the tool schema names no workflow facts: route, operation, and params come from the row", () => {
  const { parameters } = mediaGenerateDefinition();
  assert.deepEqual(Object.keys(parameters).sort(), ["generation_id", "mask_image", "model", "params", "prompt", "reference_images"]);
  assert.equal(parameters.params.additionalProperties, true);
});

test("the row decides route, operation, and where images go; params ride as flowstudio.params", () => {
  const video = mediaGenerationRequest(row("flowstudio/abc"), { model: "flowstudio/abc", prompt: "a cat", params: { seed: 7, fps: "25" } }, ["data:image/png;base64,AAAA"]);
  assert.equal(video.route, "videos");
  assert.equal(video.mode, "video_generation");
  assert.deepEqual(video.body, {
    model: "flowstudio/abc",
    prompt: "a cat",
    flowstudio: { params: { seed: 7, fps: "25" } },
    reference_images: ["data:image/png;base64,AAAA"],
  });
  const edit = mediaGenerationRequest(
    row("flowstudio/edit"),
    { model: "flowstudio/edit", prompt: "make it blue", mask_image_data_url: "data:image/png;base64,MASK", params: { strength: 0.7, style: "anime" } },
    ["data:image/png;base64,IMAGE"],
  );
  assert.equal(edit.route, "generations");
  assert.deepEqual(edit.body, {
    model: "flowstudio/edit",
    prompt: "make it blue",
    operation: "edit",
    flowstudio: { params: { strength: 0.7, style: "anime" } },
    inputs: { images: ["data:image/png;base64,IMAGE"], mask: "data:image/png;base64,MASK" },
  });
  // One row, both operations: the supplied image is what makes it an edit.
  assert.equal(planGeneration(row("openai/gpt-image"), { images: 0 }).route, "images/generations");
  assert.deepEqual(planGeneration(row("openai/gpt-image"), { images: 1 }), { route: "generations", operation: "edit", canonical: true, passCheck: { images: false, mask: false } });
  assert.deepEqual(mediaGenerationRequest(row("a/b"), { model: "a/b", prompt: "p" }).body, { model: "a/b", prompt: "p" });
});

test("a call the row cannot take is refused with the row's own parameter list", () => {
  assert.throws(() => bindParams(row("flowstudio/edit"), { denoise: 1 }), /params\.denoise is not a parameter of 图片编辑; it accepts: strength \(重绘强度, number, 0–1\); style/);
  // Values are FlowStudio's to judge: passed through exactly as given.
  assert.deepEqual(bindParams(row("flowstudio/edit"), { strength: 3, style: "动漫" }), { strength: 3, style: "动漫" });
  assert.throws(() => bindParams(row("a/b"), { seed: 1 }), /this row declares no parameters/);
  assert.throws(() => planGeneration(row("flowstudio/edit"), { images: 0 }), /needs a source image/);
  assert.throws(() => planGeneration(row("flowstudio/t2v"), { images: 1 }), /takes no reference image/);
  // Router's real rows carry no needs_reference: an edit-only row with inputs.images is the signal.
  const i2v = rowContract({ id: "Olares/i2v", mode: "video_generation", name: "Image to Video", canonical_fields: ["seed", "prompt", "inputs.images"], creative: { operations: ["edit"] }, flowstudio: { parameters: [] } });
  assert.equal(i2v.images, "required");
  assert.throws(() => planGeneration(i2v, { images: 0 }), /Image to Video needs a source image/);
  assert.equal(planGeneration(i2v, { images: 1 }).route, "videos");
  assert.throws(() => planGeneration(row("q/chat"), {}), /chat row, not an image, video, music, or 3D generation/);
  assert.throws(() => planGeneration(rowContract({ id: "x/y", mode: "image_generation", enabled: false }), {}), /disabled/);
  assert.throws(() => mediaGenerationRequest(row("a/b"), { model: "a/b", options: { seed: 1 } }), /options is not a media_generate field/);
  assert.throws(() => mediaGenerationRequest(row("a/b"), { model: "b" }), /<provider>\/<model>/);
});

test("a model missing from the catalog is refused before anything is submitted", async () => {
  const { fetch, calls } = fakeFetch({});
  await assert.rejects(
    runMediaGeneration({ model: "ghost/none", prompt: "p" }, { session: recordingSession() }, { env, fetch, sleep: noSleep }),
    /ghost\/none is not in the Router catalog/,
  );
  assert.deepEqual(calls.map((call) => call.url), ["http://router.test/v1/models?detail=capabilities"]);
});

test("an image edit reads references and mask from the workspace once", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-media-edit-"));
  try {
    writeFileSync(join(root, "source.png"), Buffer.from([1, 2, 3]));
    writeFileSync(join(root, "mask.png"), Buffer.from([4, 5, 6]));
    const { fetch, calls } = fakeFetch({
      "POST /generations": { status: 202, body: { id: "edit-1", status: "queued" } },
      "GET /generations/edit-1": {
        body: { id: "edit-1", status: "completed", outputs: [{ id: "o1", files_path: "drive/Data/flowstudio/edit.png" }] },
      },
    });
    const result = await runMediaGeneration(
      {
        mode: "image_generation",
        model: "flowstudio/edit",
        operation: "edit",
        prompt: "make it blue",
        reference_images: ["source.png"],
        mask_image: "mask.png",
      },
      { session: recordingSession(), callId: "edit-call", workspaceRoot: root },
      { env, fetch, sleep: noSleep },
    );
    assert.deepEqual(result.files, ["drive/Data/flowstudio/edit.png"]);
    const posted = JSON.parse(calls[1].init.body.toString("utf8"));
    assert.equal(posted.operation, "edit");
    assert.match(calls[1].init.headers["idempotency-key"], /^lares-[0-9a-f]{64}$/);
    assert.equal(
      calls[1].init.headers["x-olares-idempotency-key"],
      calls[1].init.headers["idempotency-key"],
    );
    assert.deepEqual(posted.inputs, {
      images: [`data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`],
      mask: `data:image/png;base64,${Buffer.from([4, 5, 6]).toString("base64")}`,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("polling waits out a busy Router and a dropped connection instead of failing", async () => {
  let dropped = false;
  const { fetch } = fakeFetch({
    "GET /generations/g1": [
      { status: 503, body: { error: { code: "model_at_capacity" } }, headers: { "retry-after": "7", "content-type": "application/json" } },
      { body: { id: "g1", status: "in_progress" } },
      { body: { id: "g1", status: "completed", outputs: [] } },
    ],
  });
  const waits: number[] = [];
  const flaky = async (url: string, init: any) => {
    if (!dropped) {
      dropped = true;
      throw new Error("socket hang up");
    }
    return fetch(url, init);
  };
  const final = await awaitMediaGeneration("g1", {
    env,
    fetch: flaky,
    sleep: async (ms: number) => { waits.push(ms); },
    intervalMs: 10,
  });
  assert.equal(final.status, "completed");
  assert.deepEqual(waits, [10, 7000, 10]);
});

test("a 404 while polling is final, not transient", async () => {
  const { fetch } = fakeFetch({
    "GET /generations/gone": { status: 404, body: { error: { code: "media_generation_not_found", message: "no" } } },
  });
  await assert.rejects(
    awaitMediaGeneration("gone", { env, fetch, sleep: noSleep }),
    (error: any) => error instanceof MediaGenerationError && error.status === 404,
  );
});

test("a run records its id before waiting and settles it with the files", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-media-"));
  try {
    writeFileSync(join(root, "ref.png"), Buffer.from([1, 2, 3]));
    const { fetch, calls } = fakeFetch({
      "POST /videos": { status: 202, body: { id: "g2", status: "queued" } },
      "GET /generations/g2": { body: { id: "g2", status: "completed", outputs: [{ id: "o1", files_path: "drive/Data/flowstudio/a.mp4" }] } },
    });
    const session = recordingSession();
    const result = await runMediaGeneration(
      { mode: "video_generation", model: "flowstudio/i2v", prompt: "move", reference_images: ["ref.png"] },
      { session, callId: "c1", workspaceRoot: root },
      { env, fetch, sleep: noSleep },
    );
    assert.deepEqual(result, { id: "g2", status: "completed", files: ["drive/Data/flowstudio/a.mp4"] });
    const posted = JSON.parse(calls[1].init.body.toString("utf8"));
    assert.deepEqual(posted.reference_images, [`data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`]);
    assert.equal(calls[1].init.headers["x-bfl-user"], "alice");
    assert.equal(
      calls[1].init.headers["idempotency-key"],
      "lares-d0f631ca1ddba8db3bcfcb9e057cdc98d0379f1bee00e75a545147a27dadd982",
    );
    assert.equal(
      calls[1].init.headers["x-olares-idempotency-key"],
      calls[1].init.headers["idempotency-key"],
    );
    assert.deepEqual(session.events.map((event) => event.type), [MEDIA_SUBMITTED_EVENT, MEDIA_SETTLED_EVENT]);
    assert.deepEqual(pendingMediaGenerations(session.events), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an output without a files address is fetched into outputs/ through Router", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-media-"));
  try {
    const { fetch } = fakeFetch({
      "POST /images/generations": { status: 202, body: { id: "g3", status: "queued" } },
      "GET /generations/g3": { body: { id: "g3", status: "completed", outputs: [{ id: "o1" }] } },
      "GET /generations/g3/content?outputId=o1": { bytes: Buffer.from("png"), headers: { "content-type": "image/png" } },
    });
    const result = await runMediaGeneration(
      { mode: "image_generation", model: "openai/gpt-image", prompt: "p" },
      { session: recordingSession(), callId: "c", workspaceRoot: root },
      { env, fetch, sleep: noSleep },
    );
    assert.deepEqual(result.files, ["outputs/g3-1.png"]);
    assert.equal(readFileSync(join(root, "outputs/g3-1.png"), "utf8"), "png");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failed generation settles the ledger and says whether waiting helps", async () => {
  const { fetch } = fakeFetch({
    "POST /videos": { status: 202, body: { id: "g4", status: "queued" } },
    "GET /generations/g4": {
      body: {
        id: "g4", status: "failed", error_code: "upstream_capacity_unavailable",
        error: "engine_host_mem_unavailable", retryable: true, retry_after_seconds: 30,
      },
    },
  });
  const session = recordingSession();
  await assert.rejects(
    runMediaGeneration(
      { mode: "video_generation", model: "flowstudio/t2v", prompt: "p" },
      { session, callId: "c", workspaceRoot: "/nonexistent" },
      { env, fetch, sleep: noSleep },
    ),
    /upstream_capacity_unavailable: engine_host_mem_unavailable \(retryable after 30s\)/,
  );
  assert.equal(session.events.at(-1).type, MEDIA_SETTLED_EVENT);
  assert.equal(session.events.at(-1).data.code, "upstream_capacity_unavailable");
});

test("an aborted wait leaves the generation pending for the next turn", async () => {
  const controller = new AbortController();
  const { fetch } = fakeFetch({
    "POST /videos": { status: 202, body: { id: "g5", status: "queued" } },
    "GET /generations/g5": { body: { id: "g5", status: "in_progress" } },
  });
  const session = recordingSession();
  await assert.rejects(runMediaGeneration(
    { mode: "video_generation", model: "flowstudio/t2v", prompt: "p" },
    { session, callId: "c", workspaceRoot: "/nonexistent", signal: controller.signal },
    {
      env,
      fetch,
      sleep: async () => {
        controller.abort(new Error("turn cancelled"));
        throw new Error("turn cancelled");
      },
    },
  ));
  assert.deepEqual(pendingMediaGenerations(session.events).map((entry: any) => entry.id), ["g5"]);
});

test("recovery presents a finished generation in the current turn and reports the rest", async () => {
  const session = recordingSession([
    { type: MEDIA_SUBMITTED_EVENT, data: { id: "done", model: "flowstudio/seamless", callId: "c7" } },
    { type: MEDIA_SUBMITTED_EVENT, data: { id: "running", model: "flowstudio/t2v", callId: "c8" } },
    { type: MEDIA_SUBMITTED_EVENT, data: { id: "expired", model: "flowstudio/t2v", callId: "c9" } },
    { type: MEDIA_SUBMITTED_EVENT, data: { id: "unreachable", model: "x/y", callId: "c10" } },
  ]);
  const { fetch } = fakeFetch({
    "GET /generations/done": { body: { id: "done", status: "completed", outputs: [{ id: "o", files_path: "drive/Data/flowstudio/15s.mp4" }] } },
    "GET /generations/running": { body: { id: "running", status: "in_progress" } },
    "GET /generations/expired": { status: 404, body: { error: { code: "media_generation_not_found" } } },
    "GET /generations/unreachable": { status: 502, body: { error: { type: "upstream_unreachable" } } },
  });
  const recovered = await recoverMediaGenerations(session, { turn: 8, workspaceRoot: "/w" }, { env, fetch });
  assert.deepEqual(recovered.map((item: any) => item.id), ["done", "running", "expired"]);
  assert.deepEqual(
    session.events.find((event) => event.type === "deliverables/presented")?.data,
    { turn: 8, callId: "media-recovered-done", files: [{ path: "drive/Data/flowstudio/15s.mp4" }] },
  );
  assert.deepEqual(pendingMediaGenerations(session.events).map((entry: any) => entry.id), ["running", "unreachable"]);
  const note = recoveredGenerationsNote(recovered);
  assert.match(note, /done .*finished and is now presented: `drive\/Data\/flowstudio\/15s\.mp4`/);
  assert.match(note, /generation_id "running"/);
  assert.match(note, /expired .*ended without output/);
  assert.match(note, /do not generate it again/);
});

test("recovery runs once per turn and adds its note to the step", async () => {
  let listener: any;
  const ctx = { on(name: string, fn: any) { assert.equal(name, "agent/pre-step"); listener = fn; } };
  const { fetch } = fakeFetch({
    "GET /generations/done": { body: { id: "done", status: "completed", outputs: [{ id: "o", files_path: "drive/Data/f.png" }] } },
  });
  installMediaRecovery(ctx as never, { env, fetch });
  const session = { ...recordingSession([{ type: MEDIA_SUBMITTED_EVENT, data: { id: "done" } }]), header: { cwd: "/w" } };
  const agent = { session };
  const next = async () => ({ kind: "enter", messages: [] });
  const first = await listener({ agent, turn: 3, step: 0 }, next);
  assert.equal(first.messages.length, 1);
  assert.match(first.messages[0].content[0].text, /finished and is now presented/);
  const second = await listener({ agent, turn: 3, step: 1 }, next);
  assert.equal(second.messages.length, 0);
});

test("media_generate publishes the paths its result names", () => {
  assert.equal(mediaGenerateDefinition().name, "media_generate");
  assert.deepEqual(publishedPathsFromToolCall("media_generate", {}, { files: ["drive/a.mp4", "outputs/b.png"] }), ["drive/a.mp4", "outputs/b.png"]);
  assert.deepEqual(publishedPathsFromToolCall("workspace_publish", { path: "x.png" }, undefined), ["x.png"]);
  assert.deepEqual(publishedPathsFromToolCall("media_generate", {}, undefined), []);
});

test("a refused submission names the Router error, never [object Object]", async () => {
  const cases: [unknown, RegExp][] = [
    [{ error: { code: "media_field_unknown", message: "sref is not a field" } }, /^media_field_unknown: sref is not a field$/],
    [{ error: { code: "model_at_capacity" } }, /^model_at_capacity: Router answered HTTP 422$/],
    [{ error: { message: { error: { message: "inputImages is required" } } } }, /^inputImages is required$/],
    [{ error: { detail: "workflow not found" } }, /^workflow not found$/],
    [{ error: { param: "inputs.images", hint: "data URL" } }, /inputs\.images/],
    [{ detail: [{ loc: ["body", "inputs", "images"], msg: "field required", type: "missing" }] }, /^body\.inputs\.images: field required$/],
    [{ message: "upstream exploded" }, /^upstream exploded$/],
    [{ error: {} }, /^Router answered HTTP 422$/],
  ];
  for (const [body, expected] of cases) {
    const { fetch } = fakeFetch({ "POST /generations": { status: 422, body } });
    await assert.rejects(
      submitMediaGeneration({ route: "generations", body: { model: "openai/gpt-image-1", prompt: "p" } }, { env, fetch }),
      (error: any) => {
        assert.ok(error instanceof MediaGenerationError);
        assert.doesNotMatch(error.message, /\[object Object\]/);
        assert.match(error.message, expected, JSON.stringify(body));
        return true;
      },
    );
  }
});

test("a failed generation with an object error reads as text", () => {
  const failure = generationFailure({ id: "g9", status: "failed", error: { code: "engine_oom", message: { reason: "VRAM" } } });
  assert.equal(failure.message, "engine_oom: VRAM");
  assert.equal(failure.code, "engine_oom");
  assert.equal(errorText({ code: "x" }), "");
  assert.equal(errorText(undefined), "");
});

test("a FlowStudio prompt travels in flowstudio.params; the top-level copy is only Router's pass-check", () => {
  const t2i = row("Olares/0509fbae-14cc-4932-9b09-0337e92ebab6");
  const request = mediaGenerationRequest(t2i, {
    model: "Olares/0509fbae-14cc-4932-9b09-0337e92ebab6",
    params: { text: "一只橘猫", megapixels: "0.92" },
  });
  assert.equal(request.route, "images/generations");
  assert.deepEqual(request.body, {
    model: "Olares/0509fbae-14cc-4932-9b09-0337e92ebab6",
    prompt: "一只橘猫",
    flowstudio: { params: { text: "一只橘猫", megapixels: "0.92" } },
  });
  assert.throws(() => bindParams(t2i, { prompt: "x" }), /accepts: text \(Prompt, textarea, the prompt, required\)/);
});

test("a FlowStudio row takes its media by slot in params; Router only sees pass-check placeholders", async () => {
  const volume = mkdtempSync(join(tmpdir(), "lares-volume-"));
  try {
    const session = join(volume, "project");
    mkdirSync(session);
    writeFileSync(join(session, "face.png"), Buffer.from([1]));
    writeFileSync(join(session, "apt.mp3"), Buffer.from([2]));
    const r2av = {
      id: "Olares/94fcee8a-c8a4-456f-b28e-40a0b107be9a",
      mode: "video_generation",
      name: "MiniMax H3 · Reference to Audio-Video",
      creative: { operations: ["edit"] },
      canonical_fields: ["seed", "prompt", "inputs.images"],
      flowstudio: {
        parameters: [
          { key: "text", label: "Prompt", type: "textarea", associateRole: "prompt", required: true },
          { key: "image__12", label: "参考人物", type: "image", required: true, media: "image", valueFormat: "filesPath" },
          { key: "audio__41", label: "口型音频", type: "audio", media: "audio", valueFormat: "filesPath" },
          { key: "megapixels", label: "Megapixels", type: "select", options: [{ label: "480p", value: "0.41" }] },
        ],
      },
    };
    const { fetch, calls } = fakeFetch({
      "GET /models?detail=capabilities": { body: { data: [r2av] } },
      "POST /videos": { status: 202, body: { id: "r2av-1", status: "queued" } },
      "GET /generations/r2av-1": { body: { id: "r2av-1", status: "completed", outputs: [{ id: "o1", files_path: "drive/Home/FlowStudio/outputs/video/a.mp4" }] } },
    });
    const result = await runMediaGeneration(
      {
        model: r2av.id,
        params: { text: "她在唱歌", image__12: "face.png", audio__41: "drive/Home/FlowStudio/uploads/apt.mp3", megapixels: "0.41" },
      },
      { session: recordingSession(), callId: "r2av-call", workspaceRoot: session },
      { env: { ...env, LARES_FLOWSTUDIO_FILES_DIR: join(volume, "FlowStudio") }, fetch, sleep: noSleep },
    );
    assert.deepEqual(result.files, ["drive/Home/FlowStudio/outputs/video/a.mp4"]);
    const posted = JSON.parse(calls[1].init.body.toString("utf8"));
    const { sref, ...params } = posted.flowstudio.params;
    // The workspace upload was copied into Home/FlowStudio/uploads, named by its content.
    const uploaded = readdirSync(join(volume, "FlowStudio", "uploads"));
    assert.equal(uploaded.length, 1);
    assert.match(uploaded[0], /^[0-9a-f]{16}_face\.png$/);
    assert.deepEqual(readFileSync(join(volume, "FlowStudio", "uploads", uploaded[0])), Buffer.from([1]));
    assert.deepEqual(params, {
      text: "她在唱歌",
      image__12: `drive/Home/FlowStudio/uploads/${uploaded[0]}`,
      audio__41: "drive/Home/FlowStudio/uploads/apt.mp3",
      megapixels: "0.41",
    });
    assert.equal(posted.prompt, "她在唱歌");
    assert.deepEqual(posted.reference_images, [PASS_CHECK_IMAGE]);
    // The old ordered-image channel is refused on a row that names its slots.
    assert.throws(
      () => mediaGenerationRequest(rowContract(r2av), { model: r2av.id, params: { text: "x" } }, ["data:image/png;base64,AA"]),
      /takes its media in params by slot: image__12 \(参考人物, image, image slot: filesPath, required\)/,
    );
  } finally {
    rmSync(volume, { recursive: true, force: true });
  }
});

test("an image edit row with slots goes canonical with a pass-check inputs.images", () => {
  const edit = rowContract({
    id: "Olares/7499312d-5fa5-48a0-832d-ea2d016abc46",
    mode: "image_generation",
    creative: { operations: ["edit"] },
    canonical_fields: ["prompt", "inputs.images"],
    flowstudio: {
      parameters: [
        { key: "text", type: "textarea", associateRole: "prompt" },
        { key: "image", type: "image", required: true, media: "image", valueFormat: "filesPath" },
      ],
    },
  });
  const request = mediaGenerationRequest(edit, {
    model: "Olares/7499312d-5fa5-48a0-832d-ea2d016abc46",
    params: { text: "戴红帽子", image: "drive/Home/Pictures/cat.png" },
  });
  assert.equal(request.route, "generations");
  assert.deepEqual(request.body, {
    model: "Olares/7499312d-5fa5-48a0-832d-ea2d016abc46",
    prompt: "戴红帽子",
    operation: "edit",
    flowstudio: { params: { text: "戴红帽子", image: "drive/Home/Pictures/cat.png" } },
    inputs: { images: [PASS_CHECK_IMAGE] },
  });
});
