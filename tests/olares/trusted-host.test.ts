import assert from "node:assert/strict";
import test from "node:test";
import { applyLoopbackHeaders, loopbackAuthority } from "@olares/lares-core/olares/trusted-host";

test("the loopback authority replaces the entrance's own", () => {
  const headers = {
    host: "www.app-test-mayuxing.cn",
    origin: "https://www.app-test-mayuxing.cn",
  };
  applyLoopbackHeaders(headers, loopbackAuthority(8080));
  assert.equal(headers.host, "127.0.0.1:8080");
  assert.equal(headers.origin, "http://127.0.0.1:8080");
});
