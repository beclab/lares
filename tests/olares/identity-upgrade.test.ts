import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../../packages/web/dsh-overlay/host/olares/olares-identity.js";

const ENTRANCE = "489966aa.one3.one2.olaresdomain.space";
const PORT = 8080;
const LOOPBACK = `127.0.0.1:${PORT}`;

/** Shaped like the node:http server the WebServer keeps on a private field. */
function fakeContext() {
  const server = new EventEmitter();
  return {
    server,
    ctx: {
      webServer: { server, port: PORT },
      effect: () => {},
    },
  };
}

/** An edge-authenticated request on the trusted entrance, from a foreign page. */
function incoming() {
  return {
    url: "/api/events.mux",
    headers: {
      host: ENTRANCE,
      origin: "file://",
      "x-bfl-user": "one3",
      cookie: "auth_token=jwt-value",
    } as Record<string, string>,
  };
}

/**
 * `LARES_CLI_ROOT` is set too because the handler writes the olares-cli profile
 * before it rewrites: a throw there is caught and silently costs the rewrite,
 * so an unwritable root would make these pass or fail for the wrong reason.
 */
function withTrustedHosts<T>(run: () => T): T {
  const previous = { ...process.env };
  process.env.DSH_TRUSTED_HOSTS = ENTRANCE;
  process.env.LARES_CLI_ROOT = mkdtempSync(join(tmpdir(), "lares-cli-"));
  try {
    return run();
  } finally {
    for (const key of ["DSH_TRUSTED_HOSTS", "LARES_CLI_ROOT"]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("a plain /api request on the entrance is rewritten to loopback", () => {
  withTrustedHosts(() => {
    const { server, ctx } = fakeContext();
    apply(ctx as never);
    const req = incoming();

    server.emit("request", req);

    assert.equal(req.headers.host, LOOPBACK);
    assert.equal(req.headers.origin, `http://${LOOPBACK}`);
  });
});

/**
 * The mux socket's regression: a WebSocket handshake is emitted as `upgrade`,
 * so a listener bound only to `request` never sees it. Unrewritten, it reaches
 * dsh's origin fence carrying `file://` and comes back 403 — while every plain
 * `/api` call on the very same entrance succeeds, which is what made this look
 * like an auth problem rather than a missing listener.
 */
test("a websocket upgrade on the entrance is rewritten the same way", () => {
  withTrustedHosts(() => {
    const { server, ctx } = fakeContext();
    apply(ctx as never);
    const req = incoming();

    // `upgrade` listeners are called with (req, socket, head); the handler only
    // reads req, so the extra arguments are passed through as the server would.
    server.emit("upgrade", req, {}, Buffer.alloc(0));

    assert.equal(req.headers.host, LOOPBACK);
    assert.equal(req.headers.origin, `http://${LOOPBACK}`);
  });
});

test("both listeners are bound, so neither path can regress on its own", () => {
  withTrustedHosts(() => {
    const { server, ctx } = fakeContext();
    apply(ctx as never);

    for (const event of ["request", "upgrade"]) {
      assert.equal(server.listenerCount(event), 1, `no listener bound for '${event}'`);
    }
  });
});

test("an untrusted host is left alone on both paths", () => {
  withTrustedHosts(() => {
    const { server, ctx } = fakeContext();
    apply(ctx as never);

    for (const event of ["request", "upgrade"]) {
      const req = incoming();
      req.headers.host = "bogus.example.com";
      server.emit(event, req);
      assert.equal(req.headers.host, "bogus.example.com");
      assert.equal(req.headers.origin, "file://");
    }
  });
});
