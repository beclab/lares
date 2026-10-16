import {
  formatElapsed,
  isRecordingTooShort,
  pickRecordingMime,
} from "./recorder.js";

export { formatElapsed };

/** Phone mic. Bare booleans are exact and iOS rejects the headset profile. */
const DEVICE_AUDIO = {
  channelCount: { ideal: 1 },
  echoCancellation: { ideal: true },
  noiseSuppression: { ideal: true },
  autoGainControl: { ideal: true },
};

const CHUNK_MS = 250;

function micFailure(err) {
  const name = err?.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "voice_permission_denied";
  if (name === "SecurityError") return "voice_unsupported";
  return "voice_failed";
}

async function openDeviceMic(mediaDevices) {
  try {
    return await mediaDevices.getUserMedia({ audio: DEVICE_AUDIO });
  } catch (err) {
    if (micFailure(err) !== "voice_failed") throw err;
    return mediaDevices.getUserMedia({ audio: true });
  }
}

export function createVoiceCapture({
  transcribe,
  submit,
  onStream,
  onPhase,
  onTrace,
  now = Date.now,
  media,
}) {
  const mediaDevices = media?.mediaDevices ?? globalThis.navigator?.mediaDevices;
  const Recorder = media?.MediaRecorder ?? globalThis.MediaRecorder;
  let recorder = null;
  let detector = null;
  let stream = null;
  let chunks = [];
  let started = 0;
  let timer = 0;
  let errorTimer = 0;
  let finishTimer = 0;
  let cancel = false;
  let released = false;
  let finished = false;
  let dead = false;
  let abort = null;
  let phase = "idle";

  const emit = (next, extra = {}) => {
    phase = next;
    onPhase?.(next, extra);
  };

  const trace = (event, fields) => {
    try {
      onTrace?.(event, fields);
    } catch {
      /* a trace must not change the take */
    }
  };

  const stopTimer = () => {
    if (timer) {
      clearInterval(timer);
      timer = 0;
    }
  };

  const release = () => {
    detector?.stop?.();
    detector = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    recorder = null;
  };

  const fail = (code) => {
    if (dead) return;
    if (errorTimer) clearTimeout(errorTimer);
    emit("error", { error: code, elapsed: 0 });
    errorTimer = setTimeout(() => {
      errorTimer = 0;
      if (!dead && phase === "error") emit("idle", { error: "", elapsed: 0 });
    }, 3200);
  };

  const finish = async () => {
    if (finished || dead) return;
    finished = true;
    stopTimer();
    const took = now() - started;
    const type = recorder?.mimeType || chunks[0]?.type || "audio/webm";
    const blobChunks = chunks;
    chunks = [];
    release();
    if (cancel) {
      emit("idle", { error: "", elapsed: 0 });
      return;
    }
    const blob = new Blob(blobChunks, { type });
    trace("blob", { bytes: blob.size, type, ms: took, chunks: blobChunks.length });
    if (isRecordingTooShort(took, blob.size)) {
      trace("too-short", { bytes: blob.size, ms: took });
      fail("voice_too_short");
      return;
    }
    emit("transcribing", { elapsed: took, error: "" });
    abort = new AbortController();
    try {
      const text = String(await transcribe(blob, abort.signal) ?? "").trim();
      if (dead || cancel) return;
      if (!text) {
        trace("no-input", {});
        fail("voice_no_input");
        return;
      }
      trace("transcript", { chars: text.length });
      emit("idle", { error: "", elapsed: 0 });
      await submit?.(text);
    } catch (err) {
      if (dead || abort.signal.aborted || cancel) return;
      const code = err instanceof Error ? err.message : "voice_failed";
      trace("transcribe-error", { code });
      fail(code);
    } finally {
      abort = null;
    }
  };

  const scheduleFinish = () => {
    if (finishTimer) clearTimeout(finishTimer);
    finishTimer = setTimeout(() => {
      finishTimer = 0;
      void finish();
    }, 30);
  };

  const endRecorder = () => {
    if (!recorder || recorder.state === "inactive") {
      scheduleFinish();
      return;
    }
    try {
      recorder.requestData?.();
    } catch {
      /* the final dataavailable still arrives from stop() */
    }
    try {
      recorder.stop();
    } catch {
      scheduleFinish();
    }
  };

  return {
    get phase() {
      return phase;
    },
    async start() {
      if (dead || phase === "preparing" || phase === "recording" || phase === "transcribing") return;
      if (typeof Recorder === "undefined" || !mediaDevices?.getUserMedia) {
        fail("voice_unsupported");
        return;
      }
      cancel = false;
      released = false;
      finished = false;
      trace("open", {});
      emit("preparing", { elapsed: 0, error: "" });
      let next;
      try {
        next = await openDeviceMic(mediaDevices);
      } catch (err) {
        const code = micFailure(err);
        trace("mic-fail", { code, name: err?.name || "" });
        if (!dead) fail(code);
        return;
      }
      if (dead || cancel) {
        next.getTracks().forEach((track) => track.stop());
        if (!dead && phase === "preparing") emit("idle", { error: "", elapsed: 0 });
        return;
      }
      stream = next;
      chunks = [];
      const mime = pickRecordingMime(Recorder);
      try {
        recorder = new Recorder(stream, mime ? { mimeType: mime } : undefined);
      } catch {
        release();
        fail("voice_unsupported");
        return;
      }
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data);
        if (recorder?.state === "inactive") scheduleFinish();
      };
      recorder.onstop = () => scheduleFinish();
      try { detector = await onStream?.(stream); } catch { release(); fail("voice_unsupported"); return; }
      started = now();
      try {
        recorder.start(CHUNK_MS);
      } catch {
        trace("record-fail", { mime });
        release();
        fail("voice_unsupported");
        return;
      }
      trace("recording", { mime: recorder.mimeType || mime || "" });
      if (released || cancel) {
        endRecorder();
        return;
      }
      emit("recording", { elapsed: 0, error: "" });
      timer = setInterval(() => emit("recording", { elapsed: now() - started, error: "" }), 200);
    },
    /**
     * Finger-up finishes the take. The mic opens asynchronously, so the finger
     * often lifts while still preparing — that is not a cancel.
     */
    stop(aborting = false) {
      if (phase === "transcribing") {
        if (aborting) {
          cancel = true;
          abort?.abort();
        }
        return;
      }
      if (phase !== "preparing" && phase !== "recording") {
        trace("stop-ignored", { aborting: Boolean(aborting), phase });
        return;
      }
      trace("stop", {
        aborting: Boolean(aborting),
        phase,
        recorder: recorder?.state || "none",
      });
      if (aborting) {
        cancel = true;
        released = false;
        if (recorder && recorder.state !== "inactive") recorder.stop();
        return;
      }
      released = true;
      stopTimer();
      if (recorder && recorder.state !== "inactive") {
        emit("transcribing", { elapsed: now() - started, error: "" });
        endRecorder();
      }
    },
    dispose() {
      dead = true;
      cancel = true;
      if (errorTimer) clearTimeout(errorTimer);
      if (finishTimer) clearTimeout(finishTimer);
      stopTimer();
      abort?.abort();
      if (recorder && recorder.state !== "inactive") recorder.stop();
      release();
    },
  };
}
