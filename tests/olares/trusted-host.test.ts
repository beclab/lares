import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLoopbackHeaders,
  hostnameOf,
  loopbackAuthority,
  shouldRewriteApiLoopback,
  trustedEntranceHosts,
  viaOlaresEntrance,
} from "@lares/core/olares/trusted-host";

test("trustedEntranceHosts splits DSH_TRUSTED_HOSTS", () => {
  assert.deepEqual(trustedEntranceHosts({ DSH_TRUSTED_HOSTS: "" }), []);
  assert.deepEqual(
    trustedEntranceHosts({ DSH_TRUSTED_HOSTS: " e3bdea4f.luolong01.olares.com , Lares.Luolong01.olares.local " }),
    ["e3bdea4f.luolong01.olares.com", "lares.luolong01.olares.local"],
  );
});

test("viaOlaresEntrance matches hostname ignoring port", () => {
  const hosts = ["e3bdea4f.luolong01.olares.com"];
  assert.equal(hostnameOf("e3bdea4f.luolong01.olares.com:443"), "e3bdea4f.luolong01.olares.com");
  assert.equal(viaOlaresEntrance("e3bdea4f.luolong01.olares.com:443", hosts), true);
  assert.equal(viaOlaresEntrance("127.0.0.1:8080", hosts), false);
  assert.equal(viaOlaresEntrance("", hosts), false);
});

test("only authenticated /api on an entrance host is rewritten to loopback", () => {
  const hosts = ["e3bdea4f.luolong01.olares.com"];
  assert.equal(
    shouldRewriteApiLoopback(
      { url: "/api/host/sessions", headers: { host: "e3bdea4f.luolong01.olares.com" } },
      hosts,
    ),
    true,
  );
  assert.equal(
    shouldRewriteApiLoopback(
      { url: "/llm/v1/models", headers: { host: "e3bdea4f.luolong01.olares.com" } },
      hosts,
    ),
    false,
  );
  const headers = { host: "e3bdea4f.luolong01.olares.com", origin: "https://e3bdea4f.luolong01.olares.com" };
  applyLoopbackHeaders(headers, loopbackAuthority(8080));
  assert.equal(headers.host, "127.0.0.1:8080");
  assert.equal(headers.origin, "http://127.0.0.1:8080");
});
