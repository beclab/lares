import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLoopbackHeaders,
  hostnameOf,
  loopbackAuthority,
  shouldRewriteApiLoopback,
  trustedEntranceHosts,
  viaOlaresEntrance,
} from "@olares/lares-core/olares/trusted-host";

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

/**
 * A custom route ID re-labels the entrance without re-rendering the chart, so
 * the env still names the label the install was given.
 */
test("viaOlaresEntrance accepts any entrance label in the same user domain", () => {
  const hosts = ["e3bdea4f.luolong01.olares.com", "e3bdea4f.luolong01.olares.local"];
  assert.equal(viaOlaresEntrance("lares.luolong01.olares.com", hosts), true);
  assert.equal(viaOlaresEntrance("lares.luolong01.olares.local:443", hosts), true);
  assert.equal(viaOlaresEntrance("lares.someoneelse.olares.com", hosts), false);
  assert.equal(viaOlaresEntrance("luolong01.olares.com", hosts), false);
  assert.equal(viaOlaresEntrance("bogus.example.com", hosts), false);
});

/**
 * A user domain is `<user>.<zone>` and the zone is not one label deep on every
 * deployment: a self-hosted `one3.one2.olaresdomain.space` carries one more
 * than `luolong01.olares.com`. Only the app's own label is stripped, so the
 * comparison neither loses the extra zone label nor mistakes a sibling user
 * for the same entrance.
 */
test("viaOlaresEntrance holds on a deeper user domain", () => {
  const hosts = [
    "489966aa.one3.one2.olaresdomain.space",
    "489966aa.one3.olares.local",
  ];
  assert.equal(viaOlaresEntrance("lares.one3.one2.olaresdomain.space", hosts), true);
  assert.equal(viaOlaresEntrance("lares.one3.olares.local", hosts), true);
  assert.equal(viaOlaresEntrance("lares.one4.one2.olaresdomain.space", hosts), false);
  // The zone itself is not an entrance: `one3` would be the app's label there.
  assert.equal(viaOlaresEntrance("lares.one2.olaresdomain.space", hosts), false);
  assert.equal(viaOlaresEntrance("one3.one2.olaresdomain.space", hosts), false);
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
