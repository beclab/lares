import assert from "node:assert/strict";
import test from "node:test";
import {
  FilesRequestClient,
  filesClientFromRequest,
  filesCredentialFromHeaders,
} from "@olares/lares-core/files/backend-client";

function request(headers: Record<string, string>) {
  return { headers } as never;
}

test("Files preview refuses a request without the browser credential", () => {
  let called = false;
  assert.throws(
    () => filesClientFromRequest(
      request({ "remote-user": "alice" }),
      {
        baseUrl: "https://files.{user}.olares.com",
        fetchFn: async () => {
          called = true;
          return new Response();
        },
      },
    ),
    { code: "files_no_credential", status: 401 },
  );
  assert.equal(called, false);
  assert.throws(
    () => filesCredentialFromHeaders({
      "remote-user": "alice",
      cookie: "auth_token=; theme=dark",
    }),
    { code: "files_no_credential" },
  );
});

test("Files preview forwards the request cookie to the authenticated user's entrance", async () => {
  const calls: Array<{ url: string; init: any }> = [];
  const client = filesClientFromRequest(
    request({
      "remote-user": "Alice@olares.com",
      cookie: "auth_token=cookie-jwt; theme=dark",
    }),
    {
      baseUrl: "https://files.{user}.olares.com",
      fetchFn: async (url: string, init: any) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({
          items: [{
            name: "clip.webm",
            size: 491,
            isDir: false,
            modified: "2026-09-19T10:00:00.000Z",
          }],
        }), { status: 200 });
      },
    },
  );

  const info = await client.stat("drive/Home/Downloads/clip.webm");
  assert.equal(info.size, 491);
  assert.equal(info.modifiedAt, Date.parse("2026-09-19T10:00:00.000Z"));
  assert.equal(calls[0].url, "https://files.alice.olares.com/api/resources/drive/Home/Downloads/");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.headers.cookie, "auth_token=cookie-jwt; theme=dark");
  assert.equal(calls[0].init.headers["x-authorization"], undefined);
});

test("Authorization bearer is normalized to X-Authorization", () => {
  assert.deepEqual(
    filesCredentialFromHeaders({
      "x-bfl-user": "alice",
      authorization: "Bearer bearer-jwt",
    }),
    { user: "alice", cookie: "", token: "bearer-jwt" },
  );
});

test("Files preview treats redirects and 401/403 as an expired browser credential", async () => {
  for (const status of [302, 401, 403]) {
    const client = new FilesRequestClient({
      baseUrl: "https://files.alice.olares.com",
      credential: { user: "alice", cookie: "", token: "stale" },
      fetchFn: async () => new Response(null, { status, headers: { location: "/signin" } }),
    });
    await assert.rejects(
      () => client.stat("drive/Home/notes.txt"),
      { code: "files_unauthenticated", status: 401 },
    );
  }
});

test("concurrent Files requests keep each browser identity isolated", async () => {
  const seen: Array<{ url: string; token: string }> = [];
  const fetchFn = async (url: string, init: any) => {
    seen.push({ url: String(url), token: init.headers["x-authorization"] });
    return new Response(JSON.stringify({
      items: [{ name: "a.txt", size: 1, isDir: false, modified: "2026-09-19T10:00:00Z" }],
    }), { status: 200 });
  };
  const alice = filesClientFromRequest(
    request({ "remote-user": "alice", "x-authorization": "alice-token" }),
    { baseUrl: "https://files.{user}.olares.com", fetchFn },
  );
  const bob = filesClientFromRequest(
    request({ "remote-user": "bob", "x-authorization": "bob-token" }),
    { baseUrl: "https://files.{user}.olares.com", fetchFn },
  );

  await Promise.all([
    alice.stat("drive/Home/a.txt"),
    bob.stat("drive/Home/a.txt"),
  ]);
  assert.deepEqual(seen, [
    { url: "https://files.alice.olares.com/api/resources/drive/Home/", token: "alice-token" },
    { url: "https://files.bob.olares.com/api/resources/drive/Home/", token: "bob-token" },
  ]);
});

test("Files stat lists the parent directory and matches the leaf", async () => {
  const calls: Array<{ url: string; method?: string }> = [];
  const client = new FilesRequestClient({
    baseUrl: "https://files.alice.olares.com",
    credential: { user: "alice", cookie: "", token: "token" },
    fetchFn: async (url: string, init: any) => {
      calls.push({ url: String(url), method: init.method });
      return new Response(JSON.stringify({
        items: [
          { name: "clip.mp4", size: 1_761_844_690, isDir: false, modified: "2026-09-20T03:48:49Z" },
          { name: "other", size: 4096, isDir: true },
        ],
      }), { status: 200 });
    },
  });
  const info = await client.stat("drive/Data/flowstudio/userData/luolong01/clip.mp4");
  assert.equal(info.size, 1_761_844_690);
  assert.equal(info.name, "clip.mp4");
  assert.deepEqual(calls, [
    {
      url: "https://files.alice.olares.com/api/resources/drive/Data/flowstudio/userData/luolong01/",
      method: "GET",
    },
  ]);
});

test("Files stat refuses a directory leaf without opening raw", async () => {
  const client = new FilesRequestClient({
    baseUrl: "https://files.alice.olares.com",
    credential: { user: "alice", cookie: "", token: "token" },
    fetchFn: async () => new Response(JSON.stringify({
      items: [{ name: "Downloads", size: 4096, isDir: true }],
    }), { status: 200 }),
  });
  await assert.rejects(
    () => client.stat("drive/Home/Downloads"),
    { code: "path_not_file", status: 415 },
  );
});

test("Files raw reads go through inline=true", async () => {
  let url = "";
  let method = "";
  const client = new FilesRequestClient({
    baseUrl: "https://files.alice.olares.com",
    credential: { user: "alice", cookie: "", token: "token" },
    fetchFn: async (href: string, init: any) => {
      url = String(href);
      method = init.method;
      return new Response("hello", { status: 200 });
    },
  });
  const result = await client.readRaw("drive/Home/notes.txt", 5);
  assert.equal(url, "https://files.alice.olares.com/api/raw/drive/Home/notes.txt?inline=true");
  assert.equal(method, "GET");
  assert.equal(result.bytes.toString(), "hello");
});

test("raw reads are range-bounded even when Files ignores Range", async () => {
  let range = "";
  const client = new FilesRequestClient({
    baseUrl: "https://files.alice.olares.com",
    credential: { user: "alice", cookie: "", token: "token" },
    fetchFn: async (_url: string, init: any) => {
      range = init.headers.range;
      return new Response("0123456789", { status: 200 });
    },
  });
  const result = await client.readRaw("drive/Home/notes.txt", 5);
  assert.equal(range, "bytes=0-5");
  assert.equal(result.bytes.toString(), "01234");
  assert.equal(result.truncated, true);
});
