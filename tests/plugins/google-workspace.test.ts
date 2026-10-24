import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { googleEnvironment, validateGoogleClient, googleEmail, validateGoogleCallback, importGoogleClient, startGoogleAuth, completeGoogleAuth, disconnectGoogle, googleStatus, checkGoogleConnection, withGoogleLock, GOOGLE_SERVICES } from "@olares/lares-core/skills/google";
import { googleBin, googleHome, googleLauncher, gogAsset, verifyGogChecksum, installGoogle, installGoogleLauncher } from "@olares/lares-core/skills/google-install";
import { GOOGLE_SKILLS, packById, packForSkillDir } from "@olares/lares-core/skills/packs";
import { enableOfficialPack, disableOfficialPack, syncRuntimeSkills, writeExportedSkills, packCacheDir, listOfficialPacks } from "@olares/lares-core/skills/state";
import { createPluginClient } from "@olares/lares-core/skills/client";
import { runProcess } from "@olares/lares-core/skills/process";
import { routes, fulfillPackDownload } from "../../packages/web/skill-packs/host/index.js";

const client = { installed: { client_id: "test.apps.googleusercontent.com", client_secret: "secret-never-return", token_uri: "https://bad.example" } };
async function tree(body: (dir: string) => unknown) {
  const dir = mkdtempSync(join(tmpdir(), "lares-google-"));
  try { return await body(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
function fakeInstalled(dir: string) { mkdirSync(join(googleBin(dir), ".."), { recursive: true }); writeFileSync(googleBin(dir), "fake"); }
function pending(dir: string) { return JSON.parse(readFileSync(join(googleHome(dir), "pending.json"), "utf8")); }
function callback(dir: string, state?: string) { const p = pending(dir); return `${p.redirectUri}?code=private-code&state=${state ?? p.state}`; }
function runner(calls: any[] = []) {
  return async (_bin: string, args: string[], options: any) => {
    calls.push({ args, stdin: options.stdin });
    assert.equal(options.env.GOG_CLIENT, "lares");
    assert.equal(options.env.GOG_KEYRING_BACKEND, "file");
    assert.ok(options.env.GOG_KEYRING_PASSWORD);
    if (args.includes("--step") && args.includes("1")) return JSON.stringify({ auth_url: "https://accounts.google.com/o/oauth2/auth?state=test-state&redirect_uri=http%3A%2F%2Flocalhost%3A1%2Foauth2%2Fcallback" });
    if (args.includes("--step") && args.includes("2")) return JSON.stringify({ stored: true, email: "test@gmail.com", client: "lares", services: GOOGLE_SERVICES });
    return JSON.stringify({ stored: true });
  };
}

test("Google client validation accepts only Desktop config and fixes endpoint URLs", () => {
  const validated = validateGoogleClient(JSON.stringify(client));
  assert.equal(validated.installed.token_uri, "https://oauth2.googleapis.com/token");
  for (const raw of ["invalid", {}, { web: client.installed }, { installed: { ...client.installed, client_id: "bad" } }]) {
    assert.throws(() => validateGoogleClient(raw), (err: any) => err.code === "invalid_google_client" && !err.message.includes(client.installed.client_secret));
  }
  assert.equal(googleEmail(" Test@Gmail.com "), "test@gmail.com");
  assert.throws(() => googleEmail("--help"));
});

test("release assets and checksums fail closed", () => {
  assert.equal(gogAsset("linux", "x64"), "gogcli_0.46.0_linux_amd64.tar.gz");
  assert.equal(gogAsset("darwin", "arm64"), "gogcli_0.46.0_darwin_arm64.tar.gz");
  assert.throws(() => gogAsset("win32", "x64"));
  const bytes = Buffer.from("archive"); const hash = createHash("sha256").update(bytes).digest("hex");
  verifyGogChecksum(bytes, `${hash}  binary.tgz`, "binary.tgz");
  assert.throws(() => verifyGogChecksum(Buffer.from("corrupt"), `${hash}  binary.tgz`, "binary.tgz"));
  assert.throws(() => verifyGogChecksum(bytes, `${hash}  different.tgz`, "binary.tgz"));
});

test("Google runtime includes the exact core gog skill and survives disable/re-enable", async () => tree((dir) => {
  const catalog = join(dir, "catalog"); mkdirSync(catalog);
  const cache = packCacheDir(dir, "google-workspace");
  assert.equal(packForSkillDir("gog")?.id, "google-workspace");
  assert.equal(packForSkillDir("gog-admin"), null);
  writeExportedSkills(cache, [{ name: "gog", body: "core" }]);
  assert.throws(() => enableOfficialPack(catalog, dir, "google-workspace"));
  writeExportedSkills(cache, GOOGLE_SKILLS.map((name) => ({ name, body: name })));
  enableOfficialPack(catalog, dir, "google-workspace");
  syncRuntimeSkills(catalog, dir);
  assert.equal(readFileSync(join(dir, "skills/gog/SKILL.md"), "utf8"), "gog");
  disableOfficialPack(catalog, dir, "google-workspace");
  assert.equal(existsSync(join(dir, "skills/gog")), false);
  assert.equal(existsSync(join(cache, "gog")), true);
  enableOfficialPack(catalog, dir, "google-workspace");
  assert.equal(existsSync(join(dir, "skills/gog/SKILL.md")), true);
}));

test("OAuth import is private, authorization binds account/state, and duplicate callbacks fail", async () => tree(async (dir) => {
  fakeInstalled(dir); const calls: any[] = []; const run = runner(calls);
  await importGoogleClient(dir, client, run);
  assert.equal(statSync(join(googleHome(dir), "keyring-password")).mode & 0o777, 0o600);
  assert.equal(googleStatus(dir).configured, true);
  assert.equal(JSON.stringify(googleStatus(dir)).includes(client.installed.client_secret), false);
  assert.equal(calls[0].args.includes(client.installed.client_secret), false);
  const auth = await startGoogleAuth(dir, "test@gmail.com", run);
  assert.match(auth.url, /^https:\/\/accounts.google.com/);
  assert.throws(() => validateGoogleCallback(callback(dir, "wrong"), pending(dir)), (err: any) => err.code === "invalid_google_state");
  assert.throws(() => validateGoogleCallback(callback(dir), pending(dir), Date.now() + 600_000), (err: any) => err.code === "google_auth_expired");
  assert.throws(() => validateGoogleCallback(callback(dir).replace("localhost", "attacker.example"), pending(dir)));
  assert.throws(() => validateGoogleCallback("http://localhost:1/oauth2/callback?error=access_denied&state=test-state", pending(dir)), (err: any) => err.code === "google_auth_cancelled");
  const url = callback(dir);
  await completeGoogleAuth(dir, url, run);
  assert.equal(googleStatus(dir).email, "test@gmail.com");
  assert.equal(googleStatus(dir).connected, true);
  assert.equal(JSON.stringify(googleStatus(dir)).includes("private-code"), false);
  await assert.rejects(completeGoogleAuth(dir, url, run), (err: any) => err.code === "google_auth_expired");
  await assert.rejects(startGoogleAuth(dir, "other@gmail.com", run), (err: any) => err.code === "google_connected");
  await assert.rejects(importGoogleClient(dir, client, run), (err: any) => err.code === "google_connected");
  await disconnectGoogle(dir, run);
  assert.equal(googleStatus(dir).configured, true);
  assert.equal(googleStatus(dir).connected, false);
  assert.equal(googleStatus(dir).email, "");
  assert.ok(calls.some(({ args }) => args.includes("remove") && args.includes("test@gmail.com")));
}));

test("failed reauthorization preserves prior account and never forwards sensitive CLI errors", async () => tree(async (dir) => {
  fakeInstalled(dir); const run = runner();
  await importGoogleClient(dir, client, run); await startGoogleAuth(dir, "test@gmail.com", run); await completeGoogleAuth(dir, callback(dir), run);
  await startGoogleAuth(dir, "test@gmail.com", run);
  await assert.rejects(completeGoogleAuth(dir, callback(dir), async () => { throw new Error("private-code secret-never-return refresh-token"); }), (err: any) => !/private-code|secret-never-return|refresh-token/.test(err.message));
  assert.equal(googleStatus(dir).email, "test@gmail.com");
  assert.equal(googleStatus(dir).connected, true);
  await assert.rejects(checkGoogleConnection(dir, async () => { throw new Error("private-token"); }), (err: any) => err.code === "google_reauthorize");
  assert.equal(googleStatus(dir).status, "reauthorize");
}));

test("concurrent auth is rejected; concurrent download is coalesced and enables only on success", async () => tree(async (dir) => {
  let finish!: () => void; const hold = new Promise<void>((resolve) => { finish = resolve; });
  const operation = withGoogleLock(dir, () => hold);
  await assert.rejects(withGoogleLock(dir, async () => {}), (err: any) => err.code === "google_busy");
  finish(); await operation;
  const catalog = join(dir, "catalog"); mkdirSync(catalog); let count = 0;
  const download = async () => { count++; await hold; writeExportedSkills(packCacheDir(dir, "google-workspace"), GOOGLE_SKILLS.map((name) => ({ name, body: name }))); };
  await Promise.all([fulfillPackDownload(packById("google-workspace"), dir, catalog, download), fulfillPackDownload(packById("google-workspace"), dir, catalog, download)]);
  assert.equal(count, 1); assert.equal(listOfficialPacks(dir).find((p) => p.id === "google-workspace")?.enabled, true);
}));

test("failed install preserves the previous cache and permits retry", async () => tree(async (dir) => {
  writeExportedSkills(packCacheDir(dir, "google-workspace"), [{ name: "gog", body: "previous" }]);
  for (let i = 0; i < 2; i++) await assert.rejects(installGoogle(dir, { download: async () => { throw new Error("network error"); } }));
  assert.equal(readFileSync(join(packCacheDir(dir, "google-workspace"), "gog/SKILL.md"), "utf8"), "previous");
}));

test("shared plugin client uses the authenticated request port and sends OAuth material in POST bodies", async () => {
  const calls: any[] = [];
  const api = createPluginClient(async (path: string, init: any) => { calls.push({ path, init }); return { ok: true, body: { packs: [] } }; });
  await api.importGoogle("secret-json"); await api.startGoogle("test@gmail.com"); await api.completeGoogle("http://localhost/?code=secret"); await api.disconnectGoogle();
  assert.deepEqual(calls.map((c) => c.path), ["/api/lares/skills/google/client", "/api/lares/skills/google/start", "/api/lares/skills/google/complete", "/api/lares/skills/google/disconnect"]);
  assert.ok(calls.every((c) => c.init.method === "POST" && !c.path.includes("secret")));
});

test("real pinned gogcli imports encrypted credentials and starts remote OAuth without a Google account", { skip: !process.env.LARES_TEST_GOG_BIN }, async () => tree(async (dir) => {
  mkdirSync(join(googleBin(dir), ".."), { recursive: true }); cpSync(process.env.LARES_TEST_GOG_BIN!, googleBin(dir));
  await importGoogleClient(dir, client);
  const passwordBefore = googleEnvironment(dir).GOG_KEYRING_PASSWORD;
  await installGoogleLauncher(dir);
  assert.match(await runProcess(googleLauncher(dir), ["--version"]), /v0\.46\.0/);
  rmSync(googleLauncher(dir));
  await installGoogleLauncher(dir);
  assert.equal(googleEnvironment(dir).GOG_KEYRING_PASSWORD, passwordBefore);
  const auth = await startGoogleAuth(dir, "test@gmail.com");
  assert.match(auth.url, /^https:\/\/accounts.google.com/);
  const url = new URL(auth.url);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(url.searchParams.get("code_challenge"));
  const credentialsPath = join(googleHome(dir), "data", "credentials-lares.json");
  assert.ok(!readFileSync(credentialsPath, "utf8").includes(client.installed.client_secret));
}));

test("connection checks inspect gog JSON validity rather than its exit code", async () => tree(async (dir) => {
  fakeInstalled(dir); const run = runner();
  await importGoogleClient(dir, client, run); await startGoogleAuth(dir, "test@gmail.com", run); await completeGoogleAuth(dir, callback(dir), run);
  await checkGoogleConnection(dir, async () => JSON.stringify({ accounts: [{ email: "test@gmail.com", client: "lares", valid: true }] }));
  assert.equal(googleStatus(dir).connected, true);
  await assert.rejects(checkGoogleConnection(dir, async () => JSON.stringify({ accounts: [{ email: "test@gmail.com", client: "lares", valid: false, error: "private-upstream-error" }] })), (err: any) => err.code === "google_reauthorize" && !err.message.includes("private-upstream-error"));
  assert.equal(googleStatus(dir).connected, false);
}));

test("mismatched account completion fails without deleting the prior connection", async () => tree(async (dir) => {
  fakeInstalled(dir); const run = runner();
  await importGoogleClient(dir, client, run); await startGoogleAuth(dir, "test@gmail.com", run); await completeGoogleAuth(dir, callback(dir), run);
  await startGoogleAuth(dir, "test@gmail.com", run);
  await assert.rejects(completeGoogleAuth(dir, callback(dir), async () => JSON.stringify({ stored: true, email: "wrong@gmail.com" })), (err: any) => err.code === "google_account_mismatch");
  assert.equal(googleStatus(dir).email, "test@gmail.com");
}));

test("all Google endpoints are registered alongside HA actions", () => {
  const paths = routes();
  for (const path of ["/google/client", "/google/start", "/google/complete", "/google/disconnect", "/google/check", "/download", "/enable", "/disable", "/connection"]) assert.equal(typeof paths[path]?.POST, "function");
});

test("Google subprocess environment drops inherited identity overrides and persists one key", async () => tree((dir) => {
  const first = googleEnvironment(dir); const second = googleEnvironment(dir);
  assert.equal(first.GOG_KEYRING_PASSWORD, second.GOG_KEYRING_PASSWORD);
  assert.equal(first.GOG_CLIENT, "lares");
  assert.equal(first.GOG_ACCESS_TOKEN, undefined);
  assert.equal(statSync(googleHome(dir)).mode & 0o777, 0o700);
}));
