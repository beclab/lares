import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_ID,
  MODELS_PATH,
  PC_TEST_PROXY,
  entranceFromDomain,
  findLaresEntrance,
  hostConfigFromEnv,
  hostUrl,
  isLaresPluginPath,
  originOf,
  probeHost,
} from "@olares/lares-core/larepass/host";

test("findLaresEntrance reads origin from myApps", () => {
  assert.equal(findLaresEntrance(undefined), "");
  assert.equal(findLaresEntrance([]), "");
  assert.equal(
    findLaresEntrance([
      { appid: "files", url: "https://files.example.olares.com/" },
      { appid: APP_ID, url: "https://489966aa.luolong01.olares.com/chat" },
    ]),
    "https://489966aa.luolong01.olares.com",
  );
  assert.equal(
    findLaresEntrance([{ id: APP_ID, url: "https://ab.example.olares.com" }]),
    "https://ab.example.olares.com",
  );
});

test("hostConfigFromEnv maps LarePass env onto Host origin and the PC-test proxy", () => {
  assert.deepEqual(hostConfigFromEnv({}), { baseUrl: "", proxyPrefix: "" });
  assert.deepEqual(
    hostConfigFromEnv({
      PROTOCOL: "https:",
      LARES_SUB_DOMAIN: "489966aa",
      ACCOUNT_DOMAIN: "luolong01.olares.com",
    }),
    { baseUrl: "https://489966aa.luolong01.olares.com", proxyPrefix: "" },
  );
  assert.equal(
    hostConfigFromEnv({ IS_PC_TEST: "1" }).proxyPrefix,
    PC_TEST_PROXY,
  );
});

test("entranceFromDomain builds the private-entrance origin", () => {
  assert.equal(entranceFromDomain({ subdomain: "", accountDomain: "x.olares.com" }), "");
  assert.equal(
    entranceFromDomain({
      protocol: "https://",
      subdomain: "489966aa",
      accountDomain: "luolong01.olares.com",
    }),
    "https://489966aa.luolong01.olares.com",
  );
});

test("hostUrl prefers the PC-test proxy over the absolute origin", () => {
  assert.equal(
    hostUrl({ baseUrl: "https://489966aa.luolong01.olares.com", path: MODELS_PATH }),
    "https://489966aa.luolong01.olares.com/api/lares/models",
  );
  assert.equal(
    hostUrl({
      baseUrl: "https://489966aa.luolong01.olares.com",
      proxyPrefix: PC_TEST_PROXY,
      path: "/api/session.list",
    }),
    "/laresHost/api/session.list",
  );
  assert.equal(
    hostUrl({
      baseUrl: "https://489966aa.luolong01.olares.com",
      proxyPrefix: PC_TEST_PROXY,
      path: MODELS_PATH,
    }),
    MODELS_PATH,
  );
  assert.equal(isLaresPluginPath("/api/lares/file-preview/raw?sessionId=s1&path=a.png"), true);
  assert.equal(isLaresPluginPath("/api/session.list"), false);
  assert.equal(originOf("not a url"), "");
});

test("probeHost maps HTTP and network failures", async () => {
  assert.deepEqual(
    await probeHost(async () => ({ status: 200, body: { ok: true } })),
    { status: "ok", http: 200, body: { ok: true } },
  );
  assert.deepEqual(await probeHost(async () => ({ status: 401 })), {
    status: "unauthorized",
    http: 401,
  });
  assert.deepEqual(await probeHost(async () => ({ status: 302 })), {
    status: "unauthorized",
    http: 302,
  });
  assert.deepEqual(await probeHost(async () => ({ status: 303 })), {
    status: "unauthorized",
    http: 303,
  });
  assert.deepEqual(await probeHost(async () => ({ status: 503 })), {
    status: "error",
    http: 503,
  });
  assert.equal((await probeHost(async () => { throw new Error("ECONNREFUSED"); })).status, "unreachable");
});
