import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("the base image ships Debian ffmpeg and CJK fonts", () => {
  const dockerfile = readFileSync(join(root, "Dockerfile.base"), "utf8");
  assert.match(dockerfile, /\bfd-find ffmpeg git\b/);
  assert.match(dockerfile, /fonts-noto-cjk/);
});
