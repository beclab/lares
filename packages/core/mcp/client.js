import { createSnapshotStore } from "../tools/async.js";

export const API = "/api/lares/mcp";

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

export function rememberedMcpSettings() {
  return settings.peek();
}

export function loadMcpSettings(options = {}) {
  return settings.load(async () => readPayload(await fetch(API), "/"), options);
}

export function saveMcpServer(server, previousName = "") {
  return post("/save", { server, previousName });
}

export function removeMcpServer(serverName) {
  return post("/remove", { serverName });
}
