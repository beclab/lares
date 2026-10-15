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
      ttsModels: Array.isArray(models.tts) ? models.tts : [],
      charts: {
        stt: chartView(models.charts?.stt),
        tts: chartView(models.charts?.tts),
      },
    };
  }, options);
}

function chartView(row) {
  const phase = row?.phase;
  return {
    app: typeof row?.app === "string" ? row.app : "",
    phase: phase === "running" || phase === "stopped" || phase === "busy" || phase === "failed" ? phase : "absent",
    state: typeof row?.state === "string" ? row.state : "",
  };
}

async function postInstall(body) {
  const res = await fetch(`${API}/install`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(String(res.status));
  return loadVoiceSettings({ force: true });
}

export function installVoiceChart(kind) {
  return postInstall({ kind });
}

export function voiceChartAction(kind, op) {
  return postInstall({ kind, op });
}

export function wavBlob(base64) {
  const raw = atob(String(base64 ?? ""));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: "audio/wav" });
}

/** Hands over a streaming answer's text; with `part`, also returns that sentence's audio. */
export async function postSpeak({ key, text, done, part }) {
  const res = await fetch(`${API}/speak`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(Number.isInteger(part) ? { key, text, done, part } : { key, text, done }),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.ok && body && !Number.isInteger(part)) return { sentences: Number(body.sentences) || 0 };
  if (!res.ok || typeof body?.audio !== "string") {
    const code = transcribeErrorCode(body);
    throw Object.assign(new Error(code), { code });
  }
  return {
    bluetooth: body.bluetooth === "played" ? "played" : "skipped",
    blob: wavBlob(body.audio),
  };
}

export async function postPlaybackStop(signal) {
  const res = await fetch(`${API}/playback/stop`, { method: "POST", signal });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
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

/** Reading mode and the GPU slicing it needs; see core/voice/gpu-mode.js. */
export async function loadGpuMode() {
  const res = await fetch(`${API}/gpu-mode`);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export async function switchGpuMode(streaming) {
  const res = await fetch(`${API}/gpu-mode`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ streaming }),
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/** @param {{ app: string, enabled: boolean, memory: number }[]} apps memory in bytes */
export async function saveSlicePlan(apps) {
  const res = await fetch(`${API}/gpu-mode/slices`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apps }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(payload?.error?.message || String(res.status)), { code: payload?.error?.code });
  return payload;
}

/** @param {string} app @param {"resume" | "stop"} op */
export async function postGpuApp(app, op) {
  const res = await fetch(`${API}/gpu-mode/app`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app, op }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(payload?.error?.message || String(res.status));
  return payload;
}

function transcribeErrorCode(payload) {
  const code = payload && typeof payload === "object" ? payload.error?.code : undefined;
  return typeof code === "string" ? code : "voice_failed";
}

export async function postBluetooth(body, signal) {
  const res = await fetch(`${API}/bluetooth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok) throw new Error(transcribeErrorCode(payload));
  return payload;
}

export function scanBluetoothDevices(signal) {
  return postBluetooth({ op: "scan" }, signal);
}

export function connectBluetoothDevice(address, signal) {
  return postBluetooth({ op: "connect", address }, signal);
}

async function readVoiceJson(res) {
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok) throw new Error(transcribeErrorCode(payload));
  return payload;
}

/** Host recording. `skipped` means the headset microphone is not available. */
export async function postCaptureStart(signal) {
  return readVoiceJson(await fetch(`${API}/capture`, { method: "POST", signal }));
}

export async function getCapture(signal) {
  return readVoiceJson(await fetch(`${API}/capture`, { signal }));
}

export async function postCaptureStop(signal) {
  return readVoiceJson(await fetch(`${API}/capture/stop`, { method: "POST", signal }));
}

export async function postCaptureCancel(signal) {
  return readVoiceJson(await fetch(`${API}/capture/cancel`, { method: "POST", signal }));
}

export async function postBluetoothReady(signal) {
  const res = await fetch(`${API}/ready`, { method: "POST", signal });
  if (!res.ok) {
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      /* fall back to the generic code */
    }
    throw new Error(transcribeErrorCode(payload));
  }
  return res.json();
}

/**
 * The only voice call that carries an audio body, and so the only one that cannot go
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
