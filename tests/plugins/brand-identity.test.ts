import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const seedPath = resolve(HERE, "../../packages/service/dsh/agents-seed.ts");

const {
  PRODUCT_NAME,
  PLATFORM_NAME,
  identityPrompt,
  surfacePrompt,
  agentsMarkdown,
  LEGACY_AGENTS_MARKDOWN,
} = await import("@lares/core/brand/identity");
const { MARK_PATH, MARK_SVG, MARK_DATA_URI } = await import("@lares/core/icons/mark");
const { MANIFEST, MANIFEST_PATH } = await import("@lares/core/brand/manifest");
const { seedWorkspaceAgents } = await import(seedPath);

test("identity prompt names the product and refuses DeepSeek Harness", () => {
  const text = identityPrompt();
  assert.match(text, new RegExp(`You are ${PRODUCT_NAME}`));
  assert.match(text, new RegExp(PLATFORM_NAME));
  assert.match(text, /Do not identify yourself as DeepSeek Harness/);
  assert.doesNotMatch(text, /powered by DeepSeek Harness/);
});

test("identity prompt keeps read_image off attached images", () => {
  assert.match(identityPrompt(), /attaches are already in context; read_image is only for image files that exist on disk/);
});

test("surface prompt is product-branded", () => {
  const text = surfacePrompt("http://127.0.0.1:8080");
  assert.match(text, new RegExp(PRODUCT_NAME));
  assert.match(text, /http:\/\/127\.0\.0\.1:8080/);
  assert.doesNotMatch(text, /DeepSeek Harness Web GUI/);
});

test("seedWorkspaceAgents writes and rewrites the legacy DeepSeek seed", () => {
  const root = mkdtempSync(join(tmpdir(), "lares-agents-"));
  try {
    seedWorkspaceAgents(root);
    assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), agentsMarkdown());

    writeFileSync(join(root, "AGENTS.md"), LEGACY_AGENTS_MARKDOWN);
    seedWorkspaceAgents(root);
    assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), agentsMarkdown());

    const custom = "# AGENTS.md\n\nCustom workspace rules.\n";
    writeFileSync(join(root, "AGENTS.md"), custom);
    seedWorkspaceAgents(root);
    assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), custom);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("product mark SVG names the product and encodes as a data URI", () => {
  assert.equal(MARK_PATH, "/lares/mark.svg");
  assert.match(MARK_SVG, new RegExp(`aria-label="${PRODUCT_NAME}"`));
  assert.match(MARK_DATA_URI, /^url\("data:image\/svg\+xml,/);
});

test("PWA manifest names the product and points at the mark", () => {
  assert.equal(MANIFEST_PATH, "/lares/manifest.webmanifest");
  assert.equal(MANIFEST.name, PRODUCT_NAME);
  assert.equal(MANIFEST.display, "fullscreen");
  assert.equal(MANIFEST.icons[0]?.src, MARK_PATH);
});
