import assert from "node:assert/strict";
import test from "node:test";
import { identityFromHeaders, olaresUsername } from "@olares/lares-core/olares/identity";
import { rememberSessionIdentity, getSessionIdentity } from "@olares/lares-core/olares/session-identity";

test("identityFromHeaders reads edge cookie and user", () => {
  const identity = identityFromHeaders(new Headers({
    "remote-user": "luolong01@olares.com",
    cookie: "auth_token=tok-abc; other=1",
    "x-forwarded-host": "e3bdea4f.luolong01.olares.com",
  }));
  assert.equal(identity.user, "luolong01@olares.com");
  assert.equal(identity.token, "tok-abc");
});

/**
 * Authelia sends the bare username far more often than the qualified id. It
 * used to become an olares-cli `olaresId` verbatim, and the CLI then filled the
 * missing domain in with `olares.com` -- correct by accident for a .com user
 * and pointed at a foreign instance for everybody else.
 */
test("identityFromHeaders passes a bare username through without a domain", () => {
  const identity = identityFromHeaders({
    "x-bfl-user": "tokikawa",
    cookie: "auth_token=tok-abc",
  });
  assert.equal(identity.user, "tokikawa");
  assert.deepEqual(Object.keys(identity).sort(), ["token", "user"]);
});

test("olaresUsername strips the domain", () => {
  assert.equal(olaresUsername("Demo1002@olares.com"), "demo1002");
  assert.equal(olaresUsername("demo1002"), "demo1002");
  assert.equal(olaresUsername(""), "");
});

test("rememberSessionIdentity stamps the Router user and nothing else", () => {
  const previousUser = process.env.OLARES_USERNAME;
  const previousHome = process.env.OLARES_CLI_HOME;
  const previousDataDir = process.env.OLARES_CLI_DATA_DIR;
  delete process.env.OLARES_CLI_HOME;
  delete process.env.OLARES_CLI_DATA_DIR;
  try {
    const identity = { user: "luolong01@olares.com", token: "tok-abc" };
    rememberSessionIdentity("sess-1", identity);
    assert.deepEqual(getSessionIdentity("sess-1"), identity);
    assert.equal(process.env.OLARES_USERNAME, "luolong01");
    // The olares-cli session comes from the credential app-service mounts;
    // pointing the CLI at a directory of our own is what shadowed it.
    assert.equal(process.env.OLARES_CLI_HOME, undefined);
    assert.equal(process.env.OLARES_CLI_DATA_DIR, undefined);
  } finally {
    if (previousUser === undefined) delete process.env.OLARES_USERNAME;
    else process.env.OLARES_USERNAME = previousUser;
    if (previousHome !== undefined) process.env.OLARES_CLI_HOME = previousHome;
    if (previousDataDir !== undefined) process.env.OLARES_CLI_DATA_DIR = previousDataDir;
  }
});
