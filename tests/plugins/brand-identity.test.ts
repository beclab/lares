import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const seedPath = resolve(HERE, "../../packages/service/dsh/agents-seed.ts");

const {
  PRODUCT_NAME,
  PLATFORM_NAME,
  identityPrompt,
  surfacePrompt,
  agentsMarkdown,
  LEGACY_AGENTS_SEEDS,
} = await import("@olares/lares-core/brand/identity");
const { MARK_PATH, MARK_SVG, MARK_DATA_URI } = await import("@olares/lares-core/icons/mark");
const { MANIFEST, MANIFEST_PATH } = await import("@olares/lares-core/brand/manifest");
const { seedWorkspaceAgents } = await import(seedPath);

const UPSTREAM_COPY = /DeepSeek|Harness|\bdsh\b/i;

test("identity prompt names the product and omits the upstream brand", () => {
  const text = identityPrompt();
  assert.match(text, new RegExp(`You are ${PRODUCT_NAME}`));
  assert.match(text, new RegExp(PLATFORM_NAME));
  assert.match(text, new RegExp(`answer as ${PRODUCT_NAME} on ${PLATFORM_NAME}`));
  assert.doesNotMatch(text, UPSTREAM_COPY);
});

test("identity prompt keeps read_image off attached images", () => {
  assert.match(identityPrompt(), /attaches are already in context; read_image is only for image files that exist on disk/);
});

test("identity prompt points media creation at the dedicated skill", () => {
  assert.match(identityPrompt(), /lares-media-create skill/);
});

test("surface prompt is product-branded", () => {
  const text = surfacePrompt("http://127.0.0.1:8080");
  assert.match(text, new RegExp(PRODUCT_NAME));
  assert.match(text, new RegExp(PLATFORM_NAME));
  assert.match(text, /http:\/\/127\.0\.0\.1:8080/);
  assert.doesNotMatch(text, UPSTREAM_COPY);
});

test("agents markdown names the product and omits the upstream brand", () => {
  const text = agentsMarkdown();
  assert.match(text, new RegExp(`via ${PRODUCT_NAME}`));
  assert.match(text, new RegExp(`you are ${PRODUCT_NAME} on ${PLATFORM_NAME}\\.`));
  assert.match(text, /lares-media-create skill/);
  assert.doesNotMatch(text, UPSTREAM_COPY);
});

test("seedWorkspaceAgents writes and rewrites previous official seeds", () => {
  const root = mkdtempSync(join(tmpdir(), "lares-agents-"));
  try {
    seedWorkspaceAgents(root);
    assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), agentsMarkdown());

    for (const legacy of LEGACY_AGENTS_SEEDS) {
      writeFileSync(join(root, "AGENTS.md"), legacy);
      seedWorkspaceAgents(root);
      assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), agentsMarkdown());
    }

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

test("market listings name Lares and omit the upstream product", () => {
  const files = [
    "deploy/lares/OlaresManifest.yaml",
    "deploy/lares/Chart.yaml",
    "deploy/lares/README.md",
    "deploy/lares/i18n/en-US/OlaresManifest.yaml",
    "deploy/lares/i18n/zh-CN/OlaresManifest.yaml",
  ];
  for (const rel of files) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    assert.match(text, /Lares/);
    assert.doesNotMatch(text, /DeepSeek Harness/);
    assert.doesNotMatch(text, /\bdsh web\b/);
    assert.doesNotMatch(text, /官方 dsh/);
  }
});
