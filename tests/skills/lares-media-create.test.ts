import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SKILL_DIR = join(ROOT, "packages/skills/lares-media-create");

function read(rel: string) {
  return readFileSync(join(SKILL_DIR, rel), "utf8");
}

test("lares-media-create is a thin front door with progressive references", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /^---\nname: lares-media-create\n/m);
  assert.match(skill, /Trigger generation through Router/);
  assert.match(skill, /GPU scheduling/);
  assert.match(skill, /1\. \*\*Router capability\*\*/);
  assert.match(skill, /2\. \*\*FlowStudio installed\?\*\*/);
  assert.match(skill, /3\. \*\*Matching FlowStudio workflow\?\*\*/);
  assert.match(skill, /4\. \*\*Other methods\*\*/);
  assert.match(skill, /5\. \*\*Deliver\*\*/);
  assert.match(skill, /references\/router\.md/);
  assert.match(skill, /references\/flowstudio\.md/);
  assert.match(skill, /references\/fallback\.md/);
  assert.match(skill, /references\/deliver\.md/);
  assert.ok(skill.split("\n").length < 80);
  assert.ok(existsSync(join(SKILL_DIR, "references/router.md")));
  assert.ok(existsSync(join(SKILL_DIR, "references/flowstudio.md")));
  assert.ok(existsSync(join(SKILL_DIR, "references/fallback.md")));
  assert.ok(existsSync(join(SKILL_DIR, "references/deliver.md")));
});

test("deliver reference lands bytes through drive tools and refuses internal hosts", () => {
  const text = read("references/deliver.md");
  assert.match(text, /url_fetch/);
  assert.match(text, /workspace_publish/);
  assert.match(text, /b64_json/);
  assert.match(text, /Do not.*url_fetch/);
  assert.match(text, /non-public host/);
  assert.match(text, /Three\.js viewer/);
  assert.match(text, /land `glb`/);
  assert.match(text, /Never curl/);
});

test("router reference forbids calling FlowStudio HTTP for generation", () => {
  const text = read("references/router.md");
  assert.match(text, /olares-cli router list --mode image_generation/);
  assert.match(text, /Never curl FlowStudio/);
  assert.match(text, /\/v1\/images\/generations/);
  assert.match(text, /do not use it as the video \/ 3D \/ audio path/);
  assert.doesNotMatch(text, /flowstudio-svc:8080/);
});

test("flowstudio reference still submits jobs through Router", () => {
  const text = read("references/flowstudio.md");
  assert.match(text, /market status flowstudio/);
  assert.match(text, /router provider sync-models flowstudio/);
  assert.match(text, /Do not `curl` `flowstudio-svc`/);
});
