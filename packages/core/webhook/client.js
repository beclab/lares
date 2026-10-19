import { createSnapshotStore } from "../tools/async.js";

export const API = "/api/lares/webhook";

const settings = createSnapshotStore();

async function readPayload(res, path) {
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error?.message ?? payload?.error?.code ?? `${path} → ${res.status}`);
  }
  return settings.remember(payload);
}

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return readPayload(res, path);
}

export function rememberedWebhookSettings() {
  return settings.peek();
}

export function loadWebhookSettings(options = {}) {
  return settings.load(async () => readPayload(await fetch(API), "/"), options);
}

export function saveWebhookSettings(config) {
  return post("/config", config);
}
