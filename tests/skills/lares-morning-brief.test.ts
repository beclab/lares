import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SKILL_DIR = join(ROOT, "packages/skills/lares-morning-brief");

function read(rel: string) {
  return readFileSync(join(SKILL_DIR, rel), "utf8");
}

test("lares-morning-brief hands briefs between sessions through files", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /^---\nname: lares-morning-brief\n/m);
  // The description routes both the scheduled write and the later question here.
  assert.match(skill, /description: ".*晨报.*今天晨报说了什么.*morning brief/);
  assert.match(skill, /A brief is a file, not a conversation/);
  assert.match(skill, /\$\{LARES_WORKSPACE:-\/data\/workspace\}\/briefs/);
  assert.match(skill, /`topics\.yaml` is the only source of topic ids/);
  assert.ok(skill.split("\n").length < 80);
  for (const ref of ["topics", "write", "read", "schedule"]) {
    assert.match(skill, new RegExp(`references/${ref}\\.md`));
    assert.ok(existsSync(join(SKILL_DIR, `references/${ref}.md`)));
  }
});

test("a failed run still leaves a file a reader can tell apart", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /\| `failed` \| Nothing usable was read/);
  assert.match(skill, /tell "ran and failed" from "never ran"/);
  const write = read("references/write.md");
  assert.match(write, /then `mv` it onto `<id>\.md`/);
  assert.match(write, /An item without one is dropped/);
  for (const key of ["topic", "date", "generated_at", "status", "item_count", "summary", "failed_sources"]) {
    assert.match(write, new RegExp(`^${key}:`, "m"));
  }
  const read_ = read("references/read.md");
  assert.match(read_, /sed -n '1,\/\^---\$\/p'/);
  assert.match(read_, /without doing so unasked/);
});

test("scheduling stays on the schedule tool or the webhook, never a container loop", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /Do not create a schedule with `sleep`/);
  const schedule = read("references/schedule.md");
  assert.match(schedule, /"daily": \{ "time": "07:00:00", "time_zone": "Asia\/Shanghai" \}/);
  assert.match(schedule, /`title` is always `晨报 · <id>`/);
  assert.match(schedule, /Never create a second reminder with the same title/);
  assert.match(schedule, /no caller authentication/);
});

test("the example topics match the documented schema", () => {
  const example = read("assets/topics.example.yaml");
  assert.match(example, /^version: 1$/m);
  const ids = [...example.matchAll(/^  - id: (\S+)$/gm)].map((m) => m[1]);
  assert.deepEqual(ids, ["tech", "finance"]);
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/);
  const times = [...example.matchAll(/^    time: "(\d\d:\d\d)"$/gm)].map((m) => m[1]);
  // Same-minute topics would arrive as one batch; the example keeps them apart.
  assert.equal(new Set(times).size, times.length);
  assert.match(read("references/topics.md"), /copy \[topics\.example\.yaml\]\(\.\.\/assets\/topics\.example\.yaml\)/);
});
