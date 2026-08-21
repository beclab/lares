export const API = "/api/dina/models";

async function readPayload(res, path) {
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error?.message ?? payload?.error?.code ?? `${path} → ${res.status}`);
  }
  return payload;
}

export async function fetchState() {
  return readPayload(await fetch(API), "/");
}

export async function refreshModels() {
  return readPayload(await fetch(`${API}/refresh`, { method: "POST" }), "/refresh");
}

/** @param {{ provider: string, model: string }} selection */
export async function setDefaultModel(selection) {
  const res = await fetch(`${API}/default`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(selection),
  });
  return readPayload(res, "/default");
}
