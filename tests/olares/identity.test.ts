import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureCliProfile, identityFromHeaders } from "@olares/lares-core/olares/identity";
import { rememberSessionIdentity, getSessionIdentity } from "@olares/lares-core/olares/session-identity";

test("identityFromHeaders reads edge cookie and user", () => {
  const identity = identityFromHeaders(new Headers({
    "remote-user": "luolong01@olares.com",
    cookie: "auth_token=tok-abc; other=1",
    "x-forwarded-host": "e3bdea4f.luolong01.olares.com",
  }));
  assert.equal(identity.user, "luolong01@olares.com");
  assert.equal(identity.token, "tok-abc");
  assert.equal(identity.terminus, "luolong01.olares.com");
});

test("ensureCliProfile writes config and keychain blob", () => {
  const root = mkdtempSync(join(tmpdir(), "lares-cli-"));
  const previous = process.env.LARES_CLI_ROOT;
  process.env.LARES_CLI_ROOT = root;
  try {
    const profile = ensureCliProfile({
      user: "luolong01@olares.com",
      token: "tok-abc",
      terminus: "luolong01.olares.com",
    });
    const cliHome = profile.env.OLARES_CLI_HOME;
    const dataDir = profile.env.OLARES_CLI_DATA_DIR;
    assert.ok(cliHome?.endsWith(".olares-cli"));
    assert.ok(dataDir);
    assert.equal(existsSync(join(cliHome, "config.json")), true);
    assert.equal(existsSync(join(dataDir, "olares-cli", "master.key")), true);
    assert.equal(existsSync(join(dataDir, "olares-cli", "luolong01_olares.com.enc")), true);
  } finally {
    if (previous === undefined) delete process.env.LARES_CLI_ROOT;
    else process.env.LARES_CLI_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("rememberSessionIdentity materializes profile env", () => {
  const root = mkdtempSync(join(tmpdir(), "lares-cli-sess-"));
  const previousRoot = process.env.LARES_CLI_ROOT;
  const previousHome = process.env.OLARES_CLI_HOME;
  process.env.LARES_CLI_ROOT = root;
  try {
    const identity = {
      user: "luolong01@olares.com",
      token: "tok-abc",
      terminus: "luolong01.olares.com",
    };
    rememberSessionIdentity("sess-1", identity);
    assert.deepEqual(getSessionIdentity("sess-1"), identity);
    assert.ok(process.env.OLARES_CLI_HOME?.includes(root));
    assert.equal(process.env.OLARES_CLI_REMOTE_ONLY, "1");
  } finally {
    if (previousRoot === undefined) delete process.env.LARES_CLI_ROOT;
    else process.env.LARES_CLI_ROOT = previousRoot;
    if (previousHome === undefined) delete process.env.OLARES_CLI_HOME;
    else process.env.OLARES_CLI_HOME = previousHome;
    delete process.env.OLARES_CLI_DATA_DIR;
    delete process.env.OLARES_CLI_REMOTE_ONLY;
    rmSync(root, { recursive: true, force: true });
  }
});
