import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadWebhookConfig,
  normalizeWebhookConfig,
  saveWebhookConfig,
  webhookPrompt,
} from "@olares/lares-core/webhook/config";
import { entranceOrigin, userDomainOf } from "@olares/lares-core/olares/entrance";
import { webhookCallUrls } from "@olares/lares-core/webhook/public";
import { lastAssistantText } from "@olares/lares-core/webhook/reply";

test("webhook config stays off until enabled and only accepts an absolute workspace", () => {
  assert.deepEqual(normalizeWebhookConfig({}), { enabled: false, workspacePath: "" });
  assert.deepEqual(normalizeWebhookConfig({ enabled: true, workspacePath: "  /tmp/demo  " }), {
    enabled: true,
    workspacePath: "/tmp/demo",
  });
  assert.throws(() => normalizeWebhookConfig({ workspacePath: "rel" }), /absolute path/);
});

test("webhook config round-trips through the data directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "lares-webhook-"));
  try {
    assert.deepEqual(loadWebhookConfig(dir), { enabled: false, workspacePath: "" });
    saveWebhookConfig(dir, { enabled: true, workspacePath: "/data/demo" });
    assert.equal(readFileSync(join(dir, "webhook.json"), "utf8").includes('"/data/demo"'), true);
    assert.deepEqual(loadWebhookConfig(dir), { enabled: true, workspacePath: "/data/demo" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("webhook call url is the entrance origin with no path", () => {
  const host = "489966aa.luolong007.olares.cn";
  const origin = entranceOrigin("webhook", { domain: userDomainOf(host), protocol: "https:" });
  assert.deepEqual(webhookCallUrls(origin), {
    post: "https://webhook.luolong007.olares.cn/",
    jobs: "https://webhook.luolong007.olares.cn/?id=",
  });
});

test("webhook prompt is required trimmed text", () => {
  assert.equal(webhookPrompt({ prompt: "  hello  " }), "hello");
  assert.throws(() => webhookPrompt({}), /prompt is required/);
  assert.throws(() => webhookPrompt({ prompt: "x".repeat(16_001) }), /too long/);
});

test("the reply is the latest non-empty assistant text", () => {
  assert.equal(lastAssistantText([
    { role: "user", content: [{ type: "text", text: "q" }] },
    { role: "assistant", content: [{ type: "text", text: "first" }] },
    { role: "assistant", content: [{ type: "text", text: "" }] },
    { role: "assistant", content: [{ type: "text", text: "second" }] },
  ]), "second");
  assert.equal(lastAssistantText([]), "");
});
