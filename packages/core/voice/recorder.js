const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

/** Below this the blob is container header only. */
export const MIN_RECORDING_MS = 700;
export const MIN_RECORDING_BYTES = 1024;

export const RECORDING_AUDIO = {
  channelCount: 1,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: true,
};

export function isRecordingTooShort(durationMs, byteSize) {
  return durationMs < MIN_RECORDING_MS || byteSize < MIN_RECORDING_BYTES;
}

/** Chrome's "Default" input is not the Pulse default. Match the headset the host just armed. */
export function pickInputDevice(devices, label) {
  const wanted = String(label ?? "").trim();
  if (!wanted) return "";
  const match = (devices ?? []).find((device) => (
    device?.kind === "audioinput"
    && device.deviceId
    && device.deviceId !== "default"
    && device.label === wanted
  ));
  return match?.deviceId ?? "";
}

async function deviceIdForLabel(mediaDevices, label) {
  const listed = async () => pickInputDevice(await mediaDevices.enumerateDevices(), label);
  const found = await listed();
  if (found) return found;
  const devices = await mediaDevices.enumerateDevices();
  if (devices.some((device) => device?.kind === "audioinput" && device.label)) return "";
  const probe = await mediaDevices.getUserMedia({ audio: true });
  probe.getTracks().forEach((track) => track.stop());
  return listed();
}

/**
 * Open the headset Chrome lists under `ready.label`.
 * Without a label there is no headset to aim at, so the browser default is used.
 */
export async function openRecordingStream(ready, mediaDevices = globalThis.navigator?.mediaDevices) {
  const label = String(ready?.label ?? "").trim();
  const audio = { ...RECORDING_AUDIO };
  if (label) {
    const deviceId = await deviceIdForLabel(mediaDevices, label);
    if (!deviceId) throw new Error("voice_bluetooth_not_ready");
    audio.deviceId = { exact: deviceId };
  }
  return mediaDevices.getUserMedia({ audio });
}

export function frameHasAudio(samples) {
  for (let i = 0; i < samples.length; i += 1) {
    if (samples[i] !== 0) return true;
  }
  return false;
}

/**
 * The headset link stays at digital silence for a couple of seconds after it opens.
 * Speech spoken into that hole never reaches the recognizer.
 */
export function waitUntilAudible(stream, timeoutMs = 4000) {
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtx) return Promise.resolve(false);
  const ctx = new AudioCtx();
  const source = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(proc);
  proc.connect(mute);
  mute.connect(ctx.destination);
  return new Promise((resolve) => {
    const finish = (heard) => {
      proc.onaudioprocess = null;
      proc.disconnect();
      source.disconnect();
      mute.disconnect();
      void ctx.close?.();
      resolve(heard);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    proc.onaudioprocess = (event) => {
      if (!frameHasAudio(event.inputBuffer.getChannelData(0))) return;
      clearTimeout(timer);
      finish(true);
    };
  });
}

export function pickRecordingMime(recorder = globalThis.MediaRecorder) {
  if (typeof recorder === "undefined" || recorder === undefined) return "";
  for (const type of MIME_CANDIDATES) {
    try {
      if (recorder.isTypeSupported(type)) return type;
    } catch {
      return "";
    }
  }
  return "";
}

export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = String(total % 60).padStart(2, "0");
  return `${Math.floor(total / 60)}:${s}`;
}
