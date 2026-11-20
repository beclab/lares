import { createSnapshotStore } from "../tools/async.js";

export const API = "/api/lares/web-fetch";

const settings = createSnapshotStore();

export function rememberedFetchSettings() {
  return settings.peek();
}

export async function loadFetchSettings(options = {}) {
  const query = options.force ? "?refresh=1" : "";
  return settings.load(() => getJson(`/config${query}`), options);
}

/** @param {{ defaultFetchModel: string | null, fetchOff: boolean }} selection */
export async function saveFetchDefault(selection) {
  return settings.remember(await postJson("/config/default", selection));
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
