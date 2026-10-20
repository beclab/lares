import { isAbsolute, join } from "node:path";
import { HttpError } from "../tools/http.js";
import { readJsonFile, writeJsonFile } from "../tools/json-file.js";

export const WEBHOOK_ROUTE = "/api/lares/webhook";
const MAX_PROMPT = 16_000;
const MAX_PATH = 1024;

export function webhookConfigPath(dataDir) {
  return join(dataDir, "webhook.json");
}

export function defaultWebhookConfig() {
  return { enabled: false, workspacePath: "" };
}

/** @param {unknown} value */
export function normalizeWebhookConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  const workspacePath = typeof source.workspacePath === "string" ? source.workspacePath.trim() : "";
  if (workspacePath.length > MAX_PATH) throw new HttpError("bad_request", 400, "workspacePath is too long");
  if (workspacePath && !isAbsolute(workspacePath)) {
    throw new HttpError("bad_request", 400, "workspacePath must be an absolute path");
  }
  return {
    enabled: source.enabled === true,
    workspacePath,
  };
}

export function loadWebhookConfig(dataDir) {
  return normalizeWebhookConfig(readJsonFile(webhookConfigPath(dataDir)) ?? {});
}

export function saveWebhookConfig(dataDir, value) {
  const config = normalizeWebhookConfig(value);
  writeJsonFile(webhookConfigPath(dataDir), config);
  return config;
}

/** @param {Record<string, unknown>} body */
export function webhookPrompt(body) {
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) throw new HttpError("bad_request", 400, "prompt is required");
  if (prompt.length > MAX_PROMPT) throw new HttpError("bad_request", 400, "prompt is too long");
  return prompt;
}

export function webhookView(config) {
  return {
    ...config,
    endpoint: WEBHOOK_ROUTE,
    jobsEndpoint: `${WEBHOOK_ROUTE}/jobs`,
  };
}
