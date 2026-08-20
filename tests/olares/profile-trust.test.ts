import assert from "node:assert/strict";
import test from "node:test";
import { trustOlaresConnectionHost } from "../../packages/service/dsh-web/profile.js";

const INTERCEPTOR =
  'if (interceptor.options.authority === "loopback" && !isTrustedApiRequest(request, []))';
const PRIVILEGED =
  "if (method !== void 0 && PRIVILEGED_METHODS.has(method) && !isTrustedApiRequest(request, []))";

test("Olares trusted hosts reach strict interceptors and privileged settings methods", () => {
  const patched = trustOlaresConnectionHost(`${INTERCEPTOR}\n${PRIVILEGED}`);
  assert.match(patched, /isTrustedApiRequest\(request, this\.trustedHosts\)/);
  assert.match(patched, /isTrustedApiRequest\(request, trustedHosts\)/);
  assert.doesNotMatch(patched, /isTrustedApiRequest\(request, \[\]\)/);
  assert.equal(trustOlaresConnectionHost(patched), patched);
});

test("connection trust patch fails loudly when upstream anchors drift", () => {
  assert.throws(
    () => trustOlaresConnectionHost("unrelated upstream source"),
    /trust patch anchor not found/,
  );
});
