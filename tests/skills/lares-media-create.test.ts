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

test("lares-media-create is a produce protocol, not a diagnosis ladder", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /^---\nname: lares-media-create\n/m);
  assert.match(skill, /is \*\*produce\*\*, not platform diagnosis/);
  assert.match(skill, /List that family only/);
  assert.match(skill, /Call \*\*once\*\*/);
  assert.match(skill, /next same-family row/);
  assert.match(skill, /`read_image` that workspace file/);
  assert.match(skill, /same meaning in English/);
  assert.match(skill, /image\*\* verb and `--out outputs\/<name>\.mp4`/);
  assert.match(skill, /do not `router call … --id`/);
  assert.match(skill, /Do not run `--help`/);
  assert.match(skill, /Do not `provider sync-models`/);
  assert.match(skill, /references\/router\.md/);
  assert.match(skill, /references\/flowstudio\.md/);
  assert.match(skill, /references\/fallback\.md/);
  assert.match(skill, /references\/deliver\.md/);
  assert.doesNotMatch(skill, /1\. \*\*Router capability\*\*/);
  assert.ok(skill.split("\n").length < 90);
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
  assert.match(text, /do \*\*not\*\* `find`/);
  assert.match(text, /never\*\* `router call … --id`/);
});

test("output families map music to music_generation, not speech audio", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /Music \/ song \/ generative audio[\s\S]*`music_generation`/);
  assert.match(skill, /Speech \/ TTS[\s\S]*`audio`/);
  assert.match(skill, /empty `audio` list is not a miss for a song/);
  assert.match(skill, /Video[\s\S]*`video_generation`/);
  assert.doesNotMatch(skill, /Music \/ generative audio \| FlowStudio `output=audio`/);
});

test("router reference forbids calling FlowStudio HTTP and catalog surgery on produce", () => {
  const text = read("references/router.md");
  assert.match(text, /do not run `--help`/);
  assert.match(text, /`speak` is TTS only/);
  assert.match(text, /Never curl FlowStudio/);
  assert.match(text, /\/v1\/images\/generations/);
  assert.match(text, /parked FlowStudio video/);
  assert.match(text, /Never `router call … --id`/);
  assert.match(text, /One row 404/);
  assert.match(text, /Do not\*\* `provider sync-models`/);
  assert.doesNotMatch(text, /olares-cli router list --mode image_generation/);
  assert.doesNotMatch(text, /flowstudio-svc:8080/);
});

test("flowstudio reference is empty-catalog only and still submits through Router", () => {
  const text = read("references/flowstudio.md");
  assert.match(text, /empty catalog only/i);
  assert.match(text, /One stale 404 is not an empty catalog/);
  assert.match(text, /market status flowstudio/);
  assert.match(text, /ask the user/i);
  assert.match(text, /router provider sync-models flowstudio/);
  assert.match(text, /Do not `curl` `flowstudio-svc`/);
});
