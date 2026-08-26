export const API = "/api/lares/voice";

export function mergeTranscript(draft, transcript) {
  const base = String(draft ?? "").replace(/\s+$/, "");
  const text = String(transcript ?? "").trim();
  if (!text) return String(draft ?? "");
  if (!base) return text;
  if (/^[,.;!?，。；！？、]/.test(text)) return `${base}${text}`;
  return `${base} ${text}`;
}

export async function postTranscribe(blob, language, signal) {
  const query = language ? `?language=${encodeURIComponent(language)}` : "";
  const res = await fetch(`${API}/transcribe${query}`, {
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
