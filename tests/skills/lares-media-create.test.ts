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
  assert.match(skill, /A FlowStudio scene or workflow is this skill/);
  assert.match(skill, /not to map a UUID to a title/);
  assert.match(skill, /`video_generation` \| `\/videos`/);
  assert.match(skill, /parked under `image_generation` still uses the \*\*image\*\* route/);
  assert.doesNotMatch(skill, /write `outputs\/<name>\.mp4`/);
  assert.match(skill, /files_path/);
  assert.match(skill, /workspace_publish/);
  assert.doesNotMatch(skill, /write `…\/content` to `outputs\/`/);
  assert.match(skill, /LARES_LLM_BASE_URL/);
  assert.match(skill, /LARES_LLM_BASE_URL\/models/);
  assert.match(skill, /workspace-write cannot create its refresh lock/);
  assert.doesNotMatch(skill, /olares-cli router list --mode/);
  assert.match(skill, /logged-in Olares user/);
  assert.match(skill, /Do not `olares-cli router call` to generate unless `olares-cli router key current`/);
  assert.match(skill, /Do not `router call … --id`/);
  assert.match(skill, /Do not run `--help`/);
  assert.match(skill, /Do not `provider sync-models`/);
  // The catalog answers both of these per row, and an agent that does not
  // know it asks FlowStudio for the first and guesses at the second.
  assert.match(skill, /`name` on the \*\*same JSON row\*\* is the label/);
  assert.match(skill, /`flowstudio\.parameters`[\s\S]*exact `key`[\s\S]*human `label`/);
  assert.match(skill, /under `flowstudio\.params`/);
  assert.match(skill, /provider-specific object/);
  assert.match(skill, /option's `value`, not its display label/);
  assert.match(skill, /absent from both `flowstudio\.parameters` and `canonical_fields`/);
  // A scene the user named by title outranks the agent's own fit scoring, and
  // a constraint that scene cannot express is a caveat, not a swap.
  assert.match(skill, /When the user named a scene, that row \*\*is\*\* the pick/);
  assert.match(skill, /never a reason to run a scene the user did not ask for/);
  assert.match(skill, /A named row only moves after its own call failed/);
  assert.match(skill, /Omitting `seed` gives the run a fresh one/);
  assert.match(skill, /references\/router\.md/);
  assert.match(skill, /references\/flowstudio\.md/);
  assert.match(skill, /references\/fallback\.md/);
  assert.match(skill, /references\/deliver\.md/);
  assert.doesNotMatch(skill, /1\. \*\*Router capability\*\*/);
  // The catalog spells the reference `inputs.images`; the shim routes read
  // `reference_images`. An agent told `image` tried nineteen spellings.
  assert.match(skill, /reference goes on that same POST as `reference_images`/);
  assert.doesNotMatch(skill, /`image` as a data URL/);
  assert.match(skill, /Never switch to a T2V row on your own/);
  assert.match(skill, /A second refusal ends the attempt/);
  // The tool owns submit, wait and publish, which is what keeps a finished
  // render from being lost when the next model request fails.
  assert.match(skill, /Call \*\*once\*\* with the `media_generate` tool/);
  assert.match(skill, /resumed with `generation_id`/);
  assert.ok(skill.split("\n").length < 95);
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
  assert.match(text, /files_path/);
  assert.match(text, /drive\/Data\/flowstudio/);
  assert.match(text, /Never copy a FlowStudio file into Home/);
  // Hunting for the file is what an agent does when the receipt disappoints
  // it, and browsing turns up a plausible wrong file often enough to pass
  // unnoticed. Naming the three ways to hunt is the point of the sentence.
  assert.match(text, /No `find`, no grep, no `olares-cli files ls`/);
  assert.match(text, /not evidence that this call produced it/);
  assert.match(text, /One deliverable per turn/);
  // The unreachable case has to end somewhere. Saying so is the answer, and
  // the file has to call it one, or the dead end reads as a reason to improvise.
  assert.match(text, /That is a complete answer/);
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
  assert.match(text, /\/videos/);
  assert.match(text, /do not GET FlowStudio to map them/);
  assert.match(text, /files_path/);
  assert.match(text, /\.by-id/);
  assert.match(text, /LARES_LLM_BASE_URL/);
  assert.match(text, /x-bfl-user/);
  assert.match(text, /Never `olares-cli router call … --id`/);
  assert.match(text, /One row 404/);
  assert.match(text, /## Image to video/);
  assert.match(text, /reference_images:\[\$i\]/);
  assert.match(text, /one corrected retry/);
  assert.match(text, /retry_after_seconds/);
  assert.match(text, /Do not\*\* `provider sync-models`/);
  assert.doesNotMatch(text, /olares-cli router list --mode image_generation/);
  assert.doesNotMatch(text, /flowstudio-svc:8080/);
  // Router carries the address now. Describing the pointer as the only source
  // sends an agent to the filesystem on the normal path, not just the old one.
  assert.match(text, /Router carries it/);
  assert.match(text, /Router old enough to drop `files_path`/);
  assert.doesNotMatch(text, /Router's own GET does not carry it/);
});

test("flowstudio reference is empty-catalog only and still submits through Router", () => {
  const text = read("references/flowstudio.md");
  assert.match(text, /empty catalog only/i);
  assert.match(text, /One stale 404 is not an empty catalog/);
  assert.match(text, /market status flowstudio/);
  assert.match(text, /ask the user/i);
  assert.match(text, /router provider sync-models flowstudio/);
  assert.match(text, /Do not `curl` `flowstudio-svc`/);
  assert.match(text, /do not GET `\/api\/projects`/);
  // Produce refuses `router list` over the workspace lock, and a repair step
  // that re-lists with it verifies nothing here for the same reason.
  assert.match(text, /LARES_LLM_BASE_URL\/models/);
  assert.doesNotMatch(text, /olares-cli router list --mode/);
});
