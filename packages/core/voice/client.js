import { createSnapshotStore } from "../tools/async.js";

export const API = "/api/lares/voice";

const settings = createSnapshotStore();

export function rememberedVoiceSettings() {
  return settings.peek();
}

export async function loadVoiceSettings(options = {}) {
  const query = options.force ? "?refresh=1" : "";
  return settings.load(async () => {
    const [config, status, models] = await Promise.all([
      getJson("/config"),
      getJson(`/status${query}`),
      getJson(`/models${query}`),
    ]);
    return {
      config,
      status,
      sttModels: Array.isArray(models.stt) ? models.stt : [],
    };
  }, options);
}

export async function saveVoiceSettings(patch) {
  const res = await fetch(`${API}/config`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(String(res.status));
  return loadVoiceSettings({ force: true });
}

export class TranscriptQueue {
  constructor() {
    this.pending = null;
  }

  apply(text, ready, draft, setDraft) {
    if (!text) return;
    if (ready) setDraft(mergeTranscript(draft, text));
    else this.pending = text;
  }

  flush(ready, draft, setDraft) {
    if (!ready || this.pending === null) return;
    const text = this.pending;
    this.pending = null;
    setDraft(mergeTranscript(draft, text));
  }
}

export function mergeTranscript(draft, transcript) {
  const base = String(draft ?? "").replace(/\s+$/, "");
  const text = String(transcript ?? "").trim();
  if (!text) return String(draft ?? "");
  if (!base) return text;
  if (/^[,.;!?，。；！？、]/.test(text)) return `${base}${text}`;
  return `${base} ${text}`;
}

function transcribeErrorCode(payload) {
  const code = payload && typeof payload === "object" ? payload.error?.code : undefined;
  return typeof code === "string" ? code : "voice_failed";
}

/**
 * The only voice call that carries a body, and so the only one that cannot go
 * through `createHostSettings`. Like the upload it must accept the host's
 * `request` port: a cross-origin host page sends no Olares cookie, so a plain
 * `fetch` here answers 401 even though `/config`, `/status` and `/models` — which
 * do ride the port — all succeed.
 */
export async function postTranscribe(blob, language, signal, options = {}) {
  const query = language ? `?language=${encodeURIComponent(language)}` : "";
  const base = String(options.baseUrl ?? API).replace(/\/$/, "");
  const url = `${base}/transcribe${query}`;
  const headers = { "content-type": blob.type || "audio/webm" };

  if (typeof options.request === "function") {
    const res = await options.request(url, { method: "POST", headers, body: blob, signal });
    if (!res?.ok) throw new Error(transcribeErrorCode(res?.body));
    return String(res?.body?.text ?? "").trim();
  }

  const res = await fetch(url, { method: "POST", headers, body: blob, signal });
  if (!res.ok) {
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      /* fall back to the generic code */
    }
    throw new Error(transcribeErrorCode(payload));
  }
  return String((await res.json())?.text ?? "").trim();
}

export async function getJson(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}
