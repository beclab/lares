import { createSnapshotStore } from "../tools/async.js";

export const API = "/api/lares/skills";

const settings = createSnapshotStore();

async function readPayload(res, path) {
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error?.message ?? payload?.error?.code ?? `${path} → ${res.status}`);
  }
  return payload;
}

async function postAction(path, id) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
  return settings.remember(await readPayload(res, path));
}

export function rememberedSkillPacks() {
  return settings.peek();
}

export async function loadSkillPacks(options = {}) {
  return settings.load(async () => readPayload(await fetch(API), "/"), options);
}

export function downloadSkillPack(id) {
  return postAction("/download", id);
}

export function enableSkillPack(id) {
  return postAction("/enable", id);
}

export function disableSkillPack(id) {
  return postAction("/disable", id);
}
