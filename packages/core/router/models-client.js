import { createSnapshotStore } from "../tools/async.js";

export const API = "/api/lares/models";

const settings = createSnapshotStore();

async function readPayload(res, path) {
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error?.message ?? payload?.error?.code ?? `${path} → ${res.status}`);
  }
  return payload;
}

export function rememberedModelSettings() {
  return settings.peek();
}

export async function loadModelSettings(options = {}) {
  return settings.load(fetchState, options);
}

export async function fetchState() {
  return readPayload(await fetch(API), "/");
}

export async function refreshModels() {
  return settings.remember(await readPayload(await fetch(`${API}/refresh`, { method: "POST" }), "/refresh"));
}

/** @param {{ provider: string, model: string }} selection */
export async function setDefaultModel(selection) {
  const res = await fetch(`${API}/default`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(selection),
  });
  return settings.remember(await readPayload(res, "/default"));
}
