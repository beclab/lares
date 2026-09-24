import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLoopbackHeaders,
  loopbackAuthority,
  viaOlaresEntrance,
} from "@olares/lares-core/olares/trusted-host";

test("viaOlaresEntrance follows the edge's user stamp, not the Host", () => {
  assert.equal(viaOlaresEntrance({ "x-bfl-user": "luolong01" }), true);
  assert.equal(viaOlaresEntrance({ "remote-user": "luolong01" }), true);
  assert.equal(viaOlaresEntrance({ host: "489966aa.luolong01.olares.com" }), false);
  assert.equal(viaOlaresEntrance({}), false);
  assert.equal(viaOlaresEntrance(undefined), false);
});

/**
 * A custom route ID re-labels the entrance and a third-party domain leaves the
 * user domain entirely; neither re-renders the chart, so no rendered host list
 * can name them. The third-party domain is also `public` — Olares rejects it on
 * a private entrance — so it carries the stamp without an Authelia cookie.
 */
test("viaOlaresEntrance holds on a re-labelled entrance and a custom domain", () => {
  assert.equal(
    viaOlaresEntrance({ host: "lares.luolong01.olares.com", "x-bfl-user": "luolong01" }),
    true,
  );
  assert.equal(
    viaOlaresEntrance({ host: "www.app-test-mayuxing.cn", "x-bfl-user": "luolong01" }),
    true,
  );
});

test("the loopback authority replaces the entrance's own", () => {
  const headers = {
    host: "www.app-test-mayuxing.cn",
    origin: "https://www.app-test-mayuxing.cn",
    "x-bfl-user": "luolong01",
  };
  applyLoopbackHeaders(headers, loopbackAuthority(8080));
  assert.equal(headers.host, "127.0.0.1:8080");
  assert.equal(headers.origin, "http://127.0.0.1:8080");
});
