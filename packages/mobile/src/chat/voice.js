import { TranscriptQueue } from "@lares/core/voice/client";
import {
  formatElapsed,
  isRecordingTooShort,
  pickRecordingMime,
  RECORDING_AUDIO,
} from "@lares/core/voice/recorder";

export { formatElapsed };

export function createVoiceCapture({ transcribe, getDraft, setDraft, onPhase }) {
  const queue = new TranscriptQueue();
  let recorder = null;
  let stream = null;
  let chunks = [];
  let started = 0;
  let timer = 0;
  let cancel = false;
  let dead = false;
  let abort = null;
  let phase = "idle";

  const emit = (next, extra = {}) => {
    phase = next;
    onPhase?.(next, extra);
  };

  const stopTimer = () => {
    if (timer) {
      clearInterval(timer);
      timer = 0;
    }
  };

  const release = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    recorder = null;
  };

  const fail = (code) => {
    if (dead) return;
    emit("error", { error: code, elapsed: 0 });
    setTimeout(() => {
      if (!dead && phase === "error") emit("idle", { error: "", elapsed: 0 });
    }, 3200);
  };

  const finish = async () => {
    stopTimer();
    const took = Date.now() - started;
    const type = recorder?.mimeType || "audio/webm";
    const blobChunks = chunks;
    chunks = [];
    release();
    if (dead) return;
    if (cancel) {
      emit("idle", { elapsed: 0 });
      return;
    }
    const blob = new Blob(blobChunks, { type });
    if (isRecordingTooShort(took, blob.size)) {
      fail("voice_too_short");
      return;
    }
    emit("transcribing", { elapsed: took });
    abort = new AbortController();
    try {
      const text = await transcribe(blob, abort.signal);
      if (dead) return;
      emit("idle", { elapsed: 0 });
      queue.apply(text, true, getDraft(), setDraft);
    } catch (err) {
      if (dead || abort.signal.aborted) return;
      fail(err instanceof Error ? err.message : "voice_failed");
    } finally {
      abort = null;
    }
  };

  return {
    get phase() {
      return phase;
    },
    async start() {
      if (dead || phase === "recording" || phase === "transcribing") return;
      if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        fail("voice_unsupported");
        return;
      }
      cancel = false;
      let next;
      try {
        next = await navigator.mediaDevices.getUserMedia({ audio: RECORDING_AUDIO });
      } catch {
        fail("voice_permission_denied");
        return;
      }
      if (dead || cancel) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = next;
      chunks = [];
      const mime = pickRecordingMime();
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        void finish();
      };
      started = Date.now();
      emit("recording", { elapsed: 0, error: "" });
      recorder.start();
      timer = setInterval(() => emit("recording", { elapsed: Date.now() - started }), 200);
    },
    stop(aborting = false) {
      cancel = Boolean(aborting);
      if (recorder && recorder.state !== "inactive") recorder.stop();
      else {
        stopTimer();
        release();
        emit("idle", { elapsed: 0 });
      }
    },
    toggle() {
      if (phase === "recording") this.stop(false);
      else if (phase === "idle" || phase === "error") void this.start();
    },
    dispose() {
      dead = true;
      stopTimer();
      abort?.abort();
      if (recorder && recorder.state !== "inactive") recorder.stop();
      release();
    },
  };
}
