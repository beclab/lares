import { createSnapshotStore } from "../tools/async.js";

export const API = "/api/lares/web-search";

const settings = createSnapshotStore();

export function rememberedSearchSettings() {
  return settings.peek();
}

export async function loadSearchSettings(options = {}) {
  return settings.load(() => getJson("/config"), options);
}

export async function saveSearchDefault(id) {
  return settings.remember(await postJson("/config/default", { defaultSearchModel: id }));
}

export async function getJson(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

export async function postJson(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = payload?.error?.code ?? String(res.status);
    const message = payload?.error?.message ?? code;
    throw new Error(message);
  }
  return payload;
}
