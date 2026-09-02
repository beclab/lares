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

export async function postTranscribe(blob, language, signal, options = {}) {
  const query = language ? `?language=${encodeURIComponent(language)}` : "";
  const base = String(options.baseUrl ?? API).replace(/\/$/, "");
  const res = await fetch(`${base}/transcribe${query}`, {
    method: "POST",
    headers: { "content-type": blob.type || "audio/webm" },
    body: blob,
    signal,
  });
  if (!res.ok) {
    let code = "voice_failed";
    try {
      code = (await res.json())?.error?.code ?? code;
    } catch {
      /* keep default */
    }
    throw new Error(code);
  }
  return String((await res.json())?.text ?? "").trim();
}

export async function getJson(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}
