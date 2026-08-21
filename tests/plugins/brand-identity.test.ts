import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const identityPath = resolve(HERE, "../../packages/plugins/bundle-web/host/brand/identity.js");
const seedPath = resolve(HERE, "../../packages/service/dsh/agents-seed.ts");

const {
  PRODUCT_NAME,
  PLATFORM_NAME,
  identityPrompt,
  surfacePrompt,
  agentsMarkdown,
  LEGACY_AGENTS_MARKDOWN,
} = await import(identityPath);
const { seedWorkspaceAgents } = await import(seedPath);

test("identity prompt names the product and refuses DeepSeek Harness", () => {
  const text = identityPrompt();
  assert.match(text, new RegExp(`You are ${PRODUCT_NAME}`));
  assert.match(text, new RegExp(PLATFORM_NAME));
  assert.match(text, /Do not identify yourself as DeepSeek Harness/);
  assert.doesNotMatch(text, /powered by DeepSeek Harness/);
});

test("surface prompt is product-branded", () => {
  const text = surfacePrompt("http://127.0.0.1:8080");
  assert.match(text, new RegExp(PRODUCT_NAME));
  assert.match(text, /http:\/\/127\.0\.0\.1:8080/);
  assert.doesNotMatch(text, /DeepSeek Harness Web GUI/);
});

test("seedWorkspaceAgents writes and rewrites the legacy DeepSeek seed", () => {
  const root = mkdtempSync(join(tmpdir(), "dina-agents-"));
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
