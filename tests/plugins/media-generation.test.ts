import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MEDIA_SETTLED_EVENT,
  MEDIA_SUBMITTED_EVENT,
  MediaGenerationError,
  awaitMediaGeneration,
  mediaGenerationRequest,
  pendingMediaGenerations,
  recoverMediaGenerations,
  recoveredGenerationsNote,
  runMediaGeneration,
} from "@olares/lares-core/media/generation";
import { mediaGenerateDefinition } from "@olares/lares-core/media/tool";
import { publishedPathsFromToolCall } from "@olares/lares-core/files/published-tools";
import { installMediaRecovery } from "../../packages/web/workspace-artifacts/host/index.js";

const env = { LLM_GATEWAY_URL: "http://router.test/v1", OLARES_USERNAME: "alice" };

type Reply = { status?: number; body?: unknown; headers?: Record<string, string>; bytes?: Buffer };

function fakeFetch(routes: Record<string, Reply[] | Reply>) {
  const calls: { url: string; init: any }[] = [];
  const fetch = async (url: string, init: any = {}) => {
    calls.push({ url, init });
    const key = `${(init.method ?? "GET").toUpperCase()} ${url.replace("http://router.test/v1", "")}`;
    const entry = routes[key];
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

test("the request sends a reference as reference_images and refuses fields the tool owns", () => {
  const request = mediaGenerationRequest(
    { mode: "video_generation", model: "flowstudio/abc", prompt: "a cat", options: { seed: 7 } },
    ["data:image/png;base64,AAAA"],
  );
  assert.equal(request.route, "videos");
  assert.deepEqual(request.body, {
    seed: 7,
    model: "flowstudio/abc",
    prompt: "a cat",
    reference_images: ["data:image/png;base64,AAAA"],
  });
  assert.throws(
    () => mediaGenerationRequest({ mode: "video_generation", model: "a/b", options: { inputs: {} } }),
    /options\.inputs is set by the tool itself/,
  );
  assert.throws(() => mediaGenerationRequest({ mode: "chat", model: "a/b" }), /mode must be one of/);
  assert.throws(() => mediaGenerationRequest({ mode: "image_generation", model: "b" }), /<provider>\/<model>/);
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
    const posted = JSON.parse(calls[0].init.body.toString("utf8"));
    assert.deepEqual(posted.reference_images, [`data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`]);
    assert.equal(calls[0].init.headers["x-bfl-user"], "alice");
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
