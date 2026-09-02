import assert from "node:assert/strict";
import test from "node:test";
import { interpolate, messageFromCode, t } from "@olares/lares-core/i18n/t";
import { EN, ZH } from "@olares/lares-core/i18n/chat-model";

const catalog = { zh: ZH, en: EN };

test("interpolate fills named placeholders and leaves missing ones", () => {
  assert.equal(interpolate("default {model}", { model: "qwen" }), "default qwen");
  assert.equal(interpolate("{name}: {msg}", { name: "x" }), "x: {msg}");
});

test("t picks zh / en tables and falls back to the key", () => {
  assert.equal(t(catalog, "zh-CN", "settings.title"), "模型");
  assert.equal(t(catalog, "en", "settings.title"), "Models");
  assert.equal(t(catalog, "fr", "settings.nav"), "Model configuration");
  assert.equal(
    t(catalog, "zh", "settings.status.ready", { model: "qwen" }),
    "对话可用 · 默认模型 qwen",
  );
  assert.equal(t(catalog, "en", "missing.key"), "missing.key");
});

test("messageFromCode maps error codes and uses the fallback key", () => {
  const table: Record<string, string> = {
    "error.file_too_large": "too big",
    "error.file_upload_failed": "failed",
  };
  const translate = (key: string) => table[key] ?? key;
  assert.equal(messageFromCode(translate, "file_too_large", "error.file_upload_failed"), "too big");
  assert.equal(messageFromCode(translate, "unknown", "error.file_upload_failed"), "failed");
});
