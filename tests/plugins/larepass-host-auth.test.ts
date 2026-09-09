import assert from "node:assert/strict";
import test from "node:test";
import { uploadFile } from "@olares/lares-core/files/upload-client";
import { postTranscribe } from "@olares/lares-core/voice/client";
import { createHostClient } from "../../packages/mobile/src/host.js";

type Call = { url: string; init: any };

/**
 * Stands in for the host's authenticated transport (LarePass injects one that
 * carries the account token). Returns the `{ ok, status, body }` envelope the
 * `request` port is defined to answer with.
 */
function recorder(response: { ok: boolean; status: number; body?: unknown }) {
  const calls: Call[] = [];
  return {
    calls,
    request: async (url: string, init: any = {}) => {
      calls.push({ url, init });
      return response;
    },
  };
}

function noFetch<T>(run: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("fetch must not be used when a request port is supplied");
  }) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test("uploadFile rides the request port instead of the cookie fetch", async () => {
  const port = recorder({ ok: true, status: 200, body: { path: ".lares/uploads/notes.md" } });
  const file = new File(["hello"], "notes.md", { type: "text/markdown" });

  const payload = await noFetch(() =>
    uploadFile(file, "s1", {
      url: "https://489966aa.alice.olares.com/api/lares/files/upload",
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      request: port.request,
    }),
  );

  assert.deepEqual(payload, { path: ".lares/uploads/notes.md" });
  assert.equal(port.calls.length, 1);
  const [call] = port.calls;
  assert.equal(call.url, "https://489966aa.alice.olares.com/api/lares/files/upload");
  assert.equal(call.init.method, "POST");
  // The body stays the raw File: the port must not re-encode it as JSON.
  assert.equal(call.init.body, file);
  assert.equal(call.init.headers["content-type"], "text/markdown");
  assert.equal(call.init.headers["x-lares-session-id"], "s1");
  assert.equal(
    call.init.headers["x-lares-file-name"],
    "notes.md",
  );
  assert.equal(
    call.init.headers["x-lares-upload-request-id"],
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  // The upload's own timeout/abort plumbing still governs the call.
  assert.ok(call.init.signal instanceof AbortSignal);
});

test("uploadFile keeps the port's status and error code on a rejection", async () => {
  const port = recorder({ ok: false, status: 401, body: { error: { code: "unauthorized" } } });
  const file = new File(["hello"], "notes.md", { type: "text/markdown" });

  await noFetch(async () => {
    const error: any = await uploadFile(file, "s1", { request: port.request }).then(
      () => null,
      (err: any) => err,
    );
    assert.equal(error?.message, "unauthorized");
    assert.equal(error?.status, 401);
  });
});

test("uploadFile without a request port still uses fetch", async () => {
  const original = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (url: string) => {
    seen.push(String(url));
    return new Response(JSON.stringify({ path: ".lares/uploads/a.md" }), { status: 200 });
  }) as typeof fetch;
  try {
    const file = new File(["a"], "a.md", { type: "text/markdown" });
    const payload = await uploadFile(file, "s1", { url: "/api/lares/files/upload" });
    assert.deepEqual(payload, { path: ".lares/uploads/a.md" });
    assert.deepEqual(seen, ["/api/lares/files/upload"]);
  } finally {
    globalThis.fetch = original;
  }
});

test("postTranscribe rides the request port and keeps the language query", async () => {
  const port = recorder({ ok: true, status: 200, body: { text: "  你好  " } });
  const blob = new Blob(["audio"], { type: "audio/webm" });

  const text = await noFetch(() =>
    postTranscribe(blob, "zh", undefined, {
      baseUrl: "https://489966aa.alice.olares.com/api/lares/voice",
      request: port.request,
    }),
  );

  assert.equal(text, "你好");
  assert.equal(port.calls.length, 1);
  const [call] = port.calls;
  assert.equal(
    call.url,
    "https://489966aa.alice.olares.com/api/lares/voice/transcribe?language=zh",
  );
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.body, blob);
  assert.equal(call.init.headers["content-type"], "audio/webm");
});

test("postTranscribe surfaces the port's error code", async () => {
  const port = recorder({ ok: false, status: 401, body: { error: { code: "unauthorized" } } });
  const blob = new Blob(["audio"], { type: "audio/webm" });

  await noFetch(async () => {
    await assert.rejects(
      () => postTranscribe(blob, "", undefined, { request: port.request }),
      /unauthorized/,
    );
  });
});

/**
 * The regression that matters: the two binary calls are reached through the
 * client, so it is the client that has to hand the port down. Without this the
 * package silently falls back to the cookie fetch and answers 401 on a
 * cross-origin host page.
 */
test("createHostClient hands its request port to upload and transcribe", async () => {
  const port = recorder({ ok: true, status: 200, body: { path: "p", text: "hi" } });
  const client = createHostClient({
    baseUrl: "https://489966aa.alice.olares.com",
    request: port.request,
  });
  const file = new File(["hello"], "notes.md", { type: "text/markdown" });
  const blob = new Blob(["audio"], { type: "audio/webm" });

  await noFetch(async () => {
    await client.upload("s1", file, {});
    await client.transcribe(blob, "en", undefined);
  });

  assert.deepEqual(
    port.calls.map((call) => call.url),
    [
      "https://489966aa.alice.olares.com/api/lares/files/upload",
      "https://489966aa.alice.olares.com/api/lares/voice/transcribe?language=en",
    ],
  );
});

/**
 * A `WebSocket` stand-in that records the constructor arguments and opens on
 * the next tick, so `openMux` resolves without a server.
 */
function fakeSocketClass() {
  const opened: Array<{ url: string; protocols: unknown }> = [];
  class FakeSocket {
    listeners: Record<string, Array<(event?: unknown) => void>> = {};
    constructor(url: string, protocols?: unknown) {
      opened.push({ url, protocols });
      queueMicrotask(() => {
        for (const fire of this.listeners.open ?? []) fire();
      });
    }
    addEventListener(type: string, fire: (event?: unknown) => void) {
      (this.listeners[type] ??= []).push(fire);
    }
    removeEventListener() {}
    close() {}
  }
  return { opened, FakeSocket };
}

async function withFakeSocket<T>(run: (opened: Array<{ url: string; protocols: unknown }>) => Promise<T>) {
  const original = globalThis.WebSocket;
  const { opened, FakeSocket } = fakeSocketClass();
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  try {
    return await run(opened);
  } finally {
    globalThis.WebSocket = original;
  }
}

/**
 * The mux upgrade takes no headers, so the token has to ride
 * `Sec-WebSocket-Protocol` — the second `WebSocket` argument.
 */
test("openMux offers the host's token as the mux subprotocol", async () => {
  await withFakeSocket(async (opened) => {
    const client = createHostClient({
      baseUrl: "https://489966aa.alice.olares.com",
      socketProtocol: () => "tok-ws",
    });

    const res = await client.openMux();

    assert.equal(res.ok, true);
    assert.deepEqual(opened, [
      { url: "wss://489966aa.alice.olares.com/api/events.mux", protocols: "tok-ws" },
    ]);
  });
});

test("openMux reads socketProtocol per connect, so a refreshed token is used", async () => {
  await withFakeSocket(async (opened) => {
    let token = "first";
    const client = createHostClient({
      baseUrl: "https://489966aa.alice.olares.com",
      socketProtocol: () => token,
    });

    await client.openMux();
    token = "second";
    await client.openMux();

    assert.deepEqual(opened.map((call) => call.protocols), ["first", "second"]);
  });
});

test("openMux takes a plain string or array socketProtocol too", async () => {
  await withFakeSocket(async (opened) => {
    await createHostClient({ baseUrl: "https://h", socketProtocol: "tok" }).openMux();
    await createHostClient({ baseUrl: "https://h", socketProtocol: ["a", "b"] }).openMux();

    assert.deepEqual(opened.map((call) => call.protocols), ["tok", ["a", "b"]]);
  });
});

/**
 * Offering a subprotocol the server does not echo aborts the handshake, so a
 * host that hands down none — the same-origin PC client — must keep the bare
 * constructor rather than get an `undefined` argument.
 */
test("openMux opens a bare socket when the host offers no protocol", async () => {
  await withFakeSocket(async (opened) => {
    await createHostClient({ baseUrl: "https://h" }).openMux();
    await createHostClient({ baseUrl: "https://h", socketProtocol: () => "" }).openMux();
    await createHostClient({ baseUrl: "https://h", socketProtocol: () => [] }).openMux();

    assert.equal(opened.length, 3);
    for (const call of opened) {
      assert.equal("protocols" in call, true);
      assert.equal(call.protocols, undefined);
    }
  });
});
