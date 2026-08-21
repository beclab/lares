import assert from "node:assert/strict";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pluginPath = resolve(HERE, "../../packages/plugins/bundle-web/host/crypto-uuid.js");

const { UUID_SHIM, injectUuidShim } = await import(pluginPath);

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type CryptoLike = {
  getRandomValues: (bytes: Uint8Array) => Uint8Array;
  randomUUID?: () => string;
};

/** Browsers withhold randomUUID on insecure origins but keep getRandomValues. */
function insecureCrypto(): CryptoLike {
  return { getRandomValues: (bytes) => webcrypto.getRandomValues(bytes) };
}

function runShim(crypto: CryptoLike): CryptoLike {
  new Function("globalThis", UUID_SHIM)({ crypto });
  return crypto;
}

test("shim mints v4 UUIDs where the origin is insecure", () => {
  const crypto = runShim(insecureCrypto());
  const first = crypto.randomUUID?.();
  assert.match(first ?? "", UUID_V4);
  assert.notEqual(first, crypto.randomUUID?.());
});

test("shim leaves a secure origin's own randomUUID in place", () => {
  const native = () => "11111111-1111-4111-8111-111111111111";
  const crypto = runShim({ ...insecureCrypto(), randomUUID: native });
  assert.equal(crypto.randomUUID, native);
});

test("shim runs before the shell bundle and stays idempotent", () => {
  const html = readFileSync(require.resolve("@deepseek-ai/dsh-web-frontend/dist/index.html"), "utf8");
  const tapped = injectUuidShim(html);
  assert.ok(tapped.indexOf("data-dina-uuid-shim") < tapped.indexOf('<script type="module"'));
  assert.equal(injectUuidShim(tapped), tapped);
});
