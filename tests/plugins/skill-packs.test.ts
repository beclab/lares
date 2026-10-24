import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectionInput, connectionStatus, profileLoginArgs, scrubSecret } from "@olares/lares-core/skills/connection";
import { parseSkillNames } from "@olares/lares-core/skills/packs";
import { OFFICIAL_PACKS } from "@olares/lares-core/skills/packs";
import { HttpError } from "@olares/lares-core/tools/http";
import {
  attemptInstall,
  briefInstallError,
  isTransientInstallError,
  packInstallArgs,
  repairCliBin,
} from "../../packages/web/skill-packs/host/cli.js";
import { fulfillPackDownload } from "../../packages/web/skill-packs/host/index.js";
import {
  disableOfficialPack,
  enableOfficialPack,
  listOfficialPacks,
  packCacheDir,
  syncRuntimeSkills,
  writeExportedSkills,
} from "@olares/lares-core/skills/state";

function withTree(body: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "lares-skills-"));
  try {
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeSkill(root: string, name: string) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\n---\n`);
}

test("parseSkillNames reads the first column of hass-cli skill list", () => {
  assert.deepEqual(
    parseSkillNames("ha-shared\tShared foundation\nha-states  Read entity states\n"),
    ["ha-shared", "ha-states"],
  );
});

test("hass-cli uses npm global-prefix layout so the executable lands in prefix/bin", () => {
  const args = packInstallArgs(OFFICIAL_PACKS[0]);
  assert.equal(args.includes("--global"), true);
  assert.equal(args.includes("--prefix"), true);
  assert.equal(args.at(-1), "@olares/hass-cli@0.0.1");
});

test("repairCliBin makes a mode-644 shim behind an existing symlink executable", () => {
  withTree((root) => {
    const shim = join(root, "hass-cli.js");
    writeFileSync(shim, "#!/usr/bin/env node\n");
    chmodSync(shim, 0o644);
    const link = join(root, "hass-cli");
    symlinkSync(shim, link);
    assert.equal(repairCliBin(link), true);
    assert.equal(statSync(shim).mode & 0o111, 0o111);
    assert.equal(repairCliBin(join(root, "missing")), false);
  });
});

test("install retries a transient github DNS failure and keeps the real error one line", async () => {
  const npmLog = [
    "npm error code 1",
    "npm error [@olares/hass-cli] failed to download vendor binary. Tried:",
    "npm error - https://github.com/beclab/hass-cli/releases/download/v0.0.1/hass-cli-v0.0.1_linux_amd64.tar.gz → getaddrinfo EAI_AGAIN github.com",
  ].join("\n");
  assert.equal(isTransientInstallError(new Error(npmLog)), true);
  assert.match(briefInstallError(new Error(npmLog)), /EAI_AGAIN github.com$/);
  assert.equal(briefInstallError(new Error(npmLog)).includes("npm error code 1"), false);

  let calls = 0;
  const value = await attemptInstall(async () => {
    calls += 1;
    if (calls < 3) throw new Error(npmLog);
    return "ok";
  }, { pause: async () => {} });
  assert.equal(value, "ok");
  assert.equal(calls, 3);

  let once = 0;
  await assert.rejects(
    attemptInstall(async () => {
      once += 1;
      throw new Error("npm error code 1\nnpm error Invalid package");
    }, { pause: async () => {} }),
    /Invalid package/,
  );
  assert.equal(once, 1);
});

test("download enables the pack so the exported skills are usable", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-skills-"));
  try {
    const catalog = join(root, "catalog");
    const dataDir = join(root, "data");
    mkdirSync(catalog, { recursive: true });
    const pack = OFFICIAL_PACKS[0];
    await fulfillPackDownload(pack, dataDir, catalog, async () => {
      writeExportedSkills(packCacheDir(dataDir, pack.id), [{
        name: "ha-shared",
        body: "---\nname: ha-shared\n---\n",
      }]);
    });
    assert.equal(listOfficialPacks(dataDir)[0].downloaded, true);
    assert.equal(listOfficialPacks(dataDir)[0].enabled, true);
    assert.match(readFileSync(join(dataDir, "skills", "ha-shared", "SKILL.md"), "utf8"), /ha-shared/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("seed copies always-on skills and skips HA until it is downloaded and enabled", () => {
  withTree((root) => {
    const catalog = join(root, "catalog");
    const dataDir = join(root, "data");
    writeSkill(catalog, "lares-media-create");
    writeSkill(catalog, "olares-files");
    writeSkill(catalog, "ha-shared");
    syncRuntimeSkills(catalog, dataDir);
    const runtime = join(dataDir, "skills");
    assert.equal(readFileSync(join(runtime, "lares-media-create", "SKILL.md"), "utf8").includes("lares-media-create"), true);
    assert.equal(readFileSync(join(runtime, "olares-files", "SKILL.md"), "utf8").includes("olares-files"), true);
    assert.throws(() => readFileSync(join(runtime, "ha-shared", "SKILL.md")));
    const listed = listOfficialPacks(dataDir);
    assert.equal(listed[0].downloaded, false);
    assert.equal(listed[0].enabled, false);
  });
});

test("enabling HA copies the downloaded cache into the runtime skills dir", () => {
  withTree((root) => {
    const catalog = join(root, "catalog");
    const dataDir = join(root, "data");
    writeSkill(catalog, "lares-media-create");
    assert.throws(() => enableOfficialPack(catalog, dataDir, "ha"));
    writeExportedSkills(packCacheDir(dataDir, "ha"), [{ name: "ha-shared", body: "---\nname: ha-shared\n---\n" }]);
    assert.throws(() => enableOfficialPack(catalog, dataDir, "missing"));
    enableOfficialPack(catalog, dataDir, "ha");
    const runtime = join(dataDir, "skills");
    assert.match(readFileSync(join(runtime, "ha-shared", "SKILL.md"), "utf8"), /ha-shared/);
    assert.equal(listOfficialPacks(dataDir)[0].enabled, true);
    disableOfficialPack(catalog, dataDir, "ha");
    assert.throws(() => readFileSync(join(runtime, "ha-shared", "SKILL.md")));
    assert.equal(listOfficialPacks(dataDir)[0].downloaded, true);
    assert.equal(listOfficialPacks(dataDir)[0].enabled, false);
  });
});

test("token entry keeps the secret off the command line and out of the status", () => {
  const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature";
  const input = connectionInput({
    server: "https://ha.example.com/",
    token: `  ${token}  `,
  });
  assert.equal(input.server, "https://ha.example.com");
  assert.equal(input.token, token);
  const args = profileLoginArgs(input.server);
  assert.equal(args.includes("--token-stdin"), true);
  assert.equal(args.includes(token), false);

  assert.deepEqual(connectionStatus("no profiles configured."), { configured: false, server: "" });
  assert.deepEqual(
    connectionStatus(JSON.stringify({ name: "lares", server: input.server, token: "should-not-leak", current: true })),
    { configured: true, server: input.server },
  );
  assert.equal(scrubSecret(`failed ${token}`, token).includes(token), false);

  assert.throws(() => connectionInput({ server: "ftp://ha.example.com", token }), HttpError);
  assert.throws(() => connectionInput({ server: "https://user:secret@ha.example.com", token }), HttpError);
  assert.throws(() => connectionInput({ server: "https://ha.example.com", token: "short" }), HttpError);
});
