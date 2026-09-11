import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSkillNames } from "@olares/lares-core/skills/packs";
import { OFFICIAL_PACKS } from "@olares/lares-core/skills/packs";
import { packInstallArgs } from "../../packages/web/skill-packs/host/cli.js";
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
