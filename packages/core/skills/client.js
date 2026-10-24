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

async function postJson(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await readPayload(res, path);
  settings.remember({ packs: payload.packs });
  return payload;
}

async function postAction(path, id) {
  return postJson(path, { id });
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

export function saveSkillConnection(id, server, token) {
  return postJson("/connection", { id, server, token });
}

/** Shared request contract for PC fetch and the authenticated LarePass bridge. */
export function createPluginClient(request = async (path, init = {}) => {
  const res = await fetch(path, { method: init.method ?? "GET", ...(init.body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }) });
  return { ok: res.ok, status: res.status, body: await res.json() };
}) {
  async function call(path = "", body) {
    const result = await request(`${API}${path}`, body === undefined ? {} : { method: "POST", body });
    if (!result?.ok) throw Object.assign(new Error(result?.body?.error?.message || "Plugin operation failed"), { code: result?.body?.error?.code });
    return result.body;
  }
  return {
    list: () => call(),
    download: (id) => call("/download", { id }),
    enable: (id) => call("/enable", { id }),
    disable: (id) => call("/disable", { id }),
    saveToken: (id, server, token) => call("/connection", { id, server, token }),
    importGoogle: (credentials) => call("/google/client", { credentials }),
    startGoogle: (email) => call("/google/start", { email }),
    completeGoogle: (callback) => call("/google/complete", { callback }),
    disconnectGoogle: () => call("/google/disconnect", {}),
    checkGoogle: () => call("/google/check", {}),
  };
}
export async function googleClientFile(file) {
  if (!file || file.size > 64 * 1024) throw new Error("Select a Desktop OAuth client JSON smaller than 64 KB");
  return file.text();
}
