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
  assert.match(skill, /A FlowStudio scene or workflow is this skill/);
  // The description is what routes an edit here; it has to name edits.
  assert.match(skill, /description: ".*media_generate.*编辑图片.*image edit/);
  assert.match(skill, /LARES_LLM_BASE_URL\/models\?detail=capabilities/);
  assert.match(skill, /`name` matches \*\*is\*\* the pick/);
  assert.match(skill, /Never swap it for one that "fits better"/);
  assert.match(skill, /`creative\.operations` must contain/);
  assert.match(skill, /Never apply this to a cloud row/);
  assert.match(skill, /\*\*is\*\* the id/);
  assert.match(skill, /Call `media_generate` once/);
  assert.match(skill, /resumed with `generation_id` alone/);
  assert.match(skill, /Never fall back to a T2V row|never fall back to a T2V row/);
  assert.ok(skill.split("\n").length < 95);
  for (const ref of ["router", "flowstudio", "fallback", "deliver"]) {
    assert.match(skill, new RegExp(`references/${ref}\\.md`));
    assert.ok(existsSync(join(SKILL_DIR, `references/${ref}.md`)));
  }
});

test("one params channel: FlowStudio's own parameter list, prompt included, passed through unchanged", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /`flowstudio\.parameters` is FlowStudio's own list of every input this workflow takes: its prompt/);
  // Media slots are parameters too: a file path per slot, in the shape valueFormat names.
  assert.match(skill, /its media slots \(entries with `media` and `valueFormat`\)/);
  assert.match(skill, /`filesPath` is one path, `filesPathBySlot` is `\{option value: path\}`, `sourceAndMask` is `\{source, mask\}`/);
  assert.match(skill, /FlowStudio checks everything else/);
  assert.match(skill, /`associateRole: "prompt"`/);
  assert.match(skill, /the tool sends it as `flowstudio\.params` unchanged/);
  assert.match(skill, /Put the user's prompt, unchanged, under the prompt key/);
  assert.match(skill, /Never invent a key, and add nothing the list does not name/);
  assert.match(skill, /A row without `flowstudio\.parameters` takes no `params`/);
  assert.match(skill, /For a row without `flowstudio\.parameters` \(a cloud model\), pass `prompt`, and `reference_images`/);
  assert.match(skill, /FlowStudio never reads/);
  assert.match(skill, /never a reason to change rows/);
  assert.doesNotMatch(skill, /`options`/);
  const router = read("references/router.md");
  assert.match(router, /the prompt under its `associateRole: "prompt"` key, and each media slot as a `drive\/Home\/FlowStudio\/…` Files path/);
  assert.match(router, /Router checks three top-level fields before it forwards, and FlowStudio never reads them/);
  assert.match(router, /Home\/FlowStudio\/uploads/);
  assert.match(router, /Nothing else goes at the top level/);
  assert.match(router, /flowstudio:\{params:\$params\}/);
});

test("the edit route is in the table, not a footnote", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /\| Image edit \(source image supplied\) \| `image_generation` \| `edit` \|/);
  const router = read("references/router.md");
  assert.match(router, /\| `image_generation`, edit \| `\/generations` \| `inputs\.images`/);
  assert.match(router, /\| `video_generation` \| `\/videos` \| `reference_images` \|/);
  assert.match(router, /An image edit is never posted to `\/images\/generations`/);
});

test("the tool publishes; deliver is only for bytes the tool did not return", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /publishes every output/);
  assert.match(skill, /Do not `workspace_publish`, download, copy, or link its files again/);
  const deliver = read("references/deliver.md");
  assert.match(deliver, /did \*\*not\*\* come from `media_generate`/);
  assert.match(deliver, /drive\/Home\/FlowStudio\/outputs/);
  assert.match(deliver, /Never publish the same bytes twice/);
  assert.match(deliver, /One deliverable per turn/);
  assert.match(deliver, /No `find`, no grep, no `olares-cli files ls`|no `find`, no grep, no `olares-cli files ls`/);
  assert.match(deliver, /not evidence that this call produced it/);
  assert.match(deliver, /That is a complete answer/);
  assert.match(deliver, /non-public hosts/);
  assert.match(deliver, /Three\.js viewer/);
});

test("the shim is only for an absent tool, and every route boundary lives in one place", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /only when that tool is not in your tool list/);
  assert.match(skill, /it never means the tool is unavailable, and it is never retried through the shim/);
  assert.match(skill, /Never call FlowStudio, ComfyUI, `router local`, Router's data plane/);
  assert.match(skill, /`olares-cli router call`/);
  assert.doesNotMatch(skill, /unless `olares-cli router key current`/);
  const router = read("references/router.md");
  assert.match(router, /Load this only when `media_generate` is not in your tool list/);
  assert.match(router, /never submit again/);
  assert.match(router, /\.by-id/);
  for (const ref of ["router", "deliver", "flowstudio", "fallback"]) {
    const text = read(`references/${ref}.md`);
    // CLI-era flags from before media_generate: they describe a call nobody makes now.
    assert.doesNotMatch(text, /--out\b|--id\b|--model\b|router default show/, ref);
    assert.doesNotMatch(text, /olares-router|olares-market\/SKILL/, ref);
  }
});

test("every failure rule is in SKILL.md, where the tool path reads it", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /## Failures/);
  assert.match(skill, /A second refusal ends the attempt/);
  assert.match(skill, /`upstream_capacity_unavailable`/);
  assert.match(skill, /call the same row once more/);
  assert.match(skill, /Try the next same-family row/);
  assert.match(skill, /A row the user named only moves after its own call failed/);
  assert.match(skill, /Never repair the catalog/);
});

test("output families map music to music_generation and speech has its own path", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /Music, song, generative audio \| `music_generation`/);
  assert.match(skill, /Speech \/ TTS \| `audio`/);
  assert.match(skill, /empty `audio` list is not a miss for a song/);
  assert.match(skill, /## Speech/);
  assert.match(skill, /\/audio\/speech/);
});

test("flowstudio reference is empty-family only and re-lists with capabilities", () => {
  const text = read("references/flowstudio.md");
  assert.match(text, /empty family only/i);
  assert.match(text, /One stale 404 is not an empty family/);
  assert.match(text, /market status flowstudio/);
  assert.match(text, /ask the user first/i);
  assert.match(text, /sync-models <provider>/);
  assert.match(text, /LARES_LLM_BASE_URL\/models\?detail=capabilities/);
  assert.doesNotMatch(text, /olares-cli router list --mode/);
});
