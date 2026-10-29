import { browserAudioErrorCode } from "./browser-audio.js";
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
  if (typeof err?.message === "string" && /^voice_[a-z0-9_]+$/.test(err.message)) return err.message;
  const name = err?.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "voice_permission_denied";
  if (name === "NotFoundError" || name === "NotReadableError") return "voice_device_lost";
  if (name === "SecurityError") return browserAudioErrorCode();
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

/** Request permission in the user gesture; transfer ownership to exactly one recorder. */
export function prepareBrowserCapture({ media, onTrace = () => {}, now = Date.now } = {}) {
  let stream = null, cancelled = false, consumed = false;
  const started = now();
  const devices = media?.mediaDevices ?? globalThis.navigator?.mediaDevices;
  const ready = (async () => {
    if (!devices?.getUserMedia) throw new Error(globalThis.isSecureContext === false ? browserAudioErrorCode() : "voice_unsupported");
    const pending = openDeviceMic(devices);
    try { onTrace("permission-request", { durationMs: now() - started }); } catch { /* Telemetry is optional. */ }
    const next = await pending;
    try { onTrace("permission", { durationMs: now() - started }); } catch { /* Telemetry is optional. */ }
    if (cancelled) { next.getTracks().forEach(track => track.stop()); return null; }
    stream = next;
    return next;
  })();
  // Permission may fail while other initialization is still pending.
  void ready.catch(() => {});
  const live = async () => {
    let next;
    try { next = await ready; }
    catch (err) {
      if (err instanceof Error && err.message.startsWith("voice_")) throw err;
      throw new Error(micFailure(err));
    }
    if (consumed || cancelled || !next) throw new Error("voice_cancelled");
    if (!next.getTracks().every((track) => track.readyState === "ended")) return next;
    // The device behind this session microphone is gone. The next hold opens
    // another one instead of failing the call.
    let replaced;
    try { replaced = await openDeviceMic(devices); }
    catch (err) { throw new Error(micFailure(err)); }
    if (cancelled) { replaced.getTracks().forEach((track) => track.stop()); throw new Error("voice_cancelled"); }
    stream = replaced;
    if (replaced.getTracks().every((track) => track.readyState === "ended")) throw new Error("voice_device_lost");
    return replaced;
  };
  return {
    /** Resolves once the microphone is open. Does not take the stream. */
    opened: live,
    /** Another take of the same voice session. A dead device is replaced; a live one is reused. */
    borrow: live,
    recording() {
      try { onTrace("ready", { durationMs: now() - started }); } catch { /* Telemetry is optional. */ }
    },
    async consume() {
      if (consumed || cancelled) throw new Error("voice_cancelled");
      consumed = true;
      const next = await ready;
      if (cancelled || !next) throw new Error("voice_cancelled");
      stream = null;
      return next;
    },
    cancel() {
      cancelled = true;
      stream?.getTracks().forEach(track => track.stop());
      stream = null;
    },
  };
}

export function createVoiceCapture({
  transcribe,
  streamInput,
  submit,
  onStream,
  onPhase,
  onTrace,
  now = Date.now,
  media,
  preparation,
  retainStream = false,
}) {
  const mediaDevices = media?.mediaDevices ?? globalThis.navigator?.mediaDevices;
  const Recorder = media?.MediaRecorder ?? globalThis.MediaRecorder;
  let inputAbort = null;
  let streaming = null;
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
    // A session microphone stays open for the next hold. Only a take that
    // opened its own stream stops the tracks when the take ends.
    if (!retainStream) stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    recorder = null;
  };

  const fail = (code, extra = {}) => {
    if (dead) return;
    if (errorTimer) clearTimeout(errorTimer);
    emit("error", { error: code, elapsed: 0, ...extra });
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
      streaming?.cancel(); streaming = null;
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
      let text = "";
      let committed = false, replayable = true;
      if (streaming) {
        const port = streaming;
        streaming = null;
        committed = port.committed === true;
        replayable = port.replayable !== false;
        try {
          text = String(await port.finish() ?? "").trim();
        } catch (err) {
          if (dead || abort.signal.aborted || cancel) return;
          text = "";
        }
        // finish() is the commit; the Host transcribed this audio and returned
        // nothing. Uploading the blob again would submit the same take twice.
        committed ||= port.committed === true;
        replayable = port.replayable !== false;
      }
      // The socket can finish with nothing while the recording still has the words.
      if (!text && (!committed || replayable)) text = String(await transcribe(blob, abort.signal) ?? "").trim();
      if (dead || cancel) return;
      if (!text) {
        trace("no-input", {});
        fail("voice_no_input", { recognizedEmpty: true });
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
      return;
    }
    // Some WebViews never fire onstop. The button already switched the UI to
    // transcribing, so finish with the chunks collected so far instead of waiting.
    if (!finishTimer) {
      finishTimer = setTimeout(() => {
        finishTimer = 0;
        void finish();
      }, 1000);
    }
  };

  return {
    get phase() {
      return phase;
    },
    async start() {
      if (dead || phase === "preparing" || phase === "recording" || phase === "transcribing") return;
      if (typeof Recorder === "undefined" || !mediaDevices?.getUserMedia) {
        if (!retainStream) preparation?.cancel();
        fail("voice_unsupported");
        return;
      }
      inputAbort = new AbortController();
      cancel = false;
      released = false;
      finished = false;
      trace("open", {});
      emit("preparing", { elapsed: 0, error: "" });
      let next;
      try {
        next = await (retainStream ? preparation.borrow() : preparation ? preparation.consume() : openDeviceMic(mediaDevices));
      } catch (err) {
        if (!retainStream) preparation?.cancel();
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
      try {
        const nextDetector = await onStream?.(stream);
        if (dead || cancel) { nextDetector?.stop?.(); release(); return; }
        detector = nextDetector;
      } catch (error) { release(); if (!dead && !cancel) fail(error.message || "voice_unsupported"); return; }
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
      preparation?.recording();
      timer = setInterval(() => emit("recording", { elapsed: now() - started, error: "" }), 200);
      // The recognizer socket is not the microphone. A take that is already
      // recording keeps its blob when the socket is still closed.
      const pending = streamInput?.(stream, { signal: inputAbort.signal, onPartial: (text) => emit(phase, { partial: text }) });
      if (pending && typeof pending.then === "function") {
        pending.then((port) => {
          if (!port) return;
          if (dead || cancel || finished || released || chunks.length) { port.cancel?.(); return; }
          streaming = port;
        }, () => {});
      } else if (pending) streaming = pending;
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
          streaming?.cancel(); streaming = null;
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
        inputAbort?.abort();
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
      if (!retainStream) preparation?.cancel();
      inputAbort?.abort();
      dead = true;
      cancel = true;
      if (errorTimer) clearTimeout(errorTimer);
      if (finishTimer) clearTimeout(finishTimer);
      stopTimer();
      abort?.abort();
      streaming?.cancel(); streaming = null;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      release();
    },
  };
}
