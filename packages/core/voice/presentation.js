/** Stable status keys keep waveform/timer updates out of live announcements. */
export function voicePanelPresentation(view) {
  const capture = view.snapshot?.capture;
  const processing = view.stage === "processing";
  const transcribing = capture === "transcribing";
  const preview = view.mode === "single" && ["preview", "processing"].includes(view.stage);
  const preparing = view.busy || capture === "recording" && view.snapshot?.inputReady === false;
  const recording = capture === "recording" && !preparing;
  const error = view.error || view.snapshot?.error;
  const phase = view.cancelArmed ? "cancel" : error ? "error" : processing ? "processing" : transcribing ? "transcribing" : preparing ? "preparing" : recording ? "recording" : preview ? "preview" : view.snapshot && view.snapshot.playback !== "idle" ? "speaking" : view.snapshot?.agent === "running" ? "working" : "waiting";
  const status = error ? `error.${error}` : ({ cancel: "gesture.cancelRelease", processing: "dictation.processing", transcribing: "mic.transcribing", preparing: "mic.preparing", recording: "call.listening", preview: "dictation.preview", speaking: "dictation.speaking", working: "call.working", waiting: view.mode === "continuous" ? "gesture.waiting" : "dictation.preview" })[phase];
  return { phase, status, preview, recording, pending: processing || transcribing || preparing, error };
}

/** Shared inline labels; clients own focus, positioning and the timer tick. */
export function voiceInputPresentation(view, now = Date.now()) {
  const ui = voicePanelPresentation(view);
  const seconds = Math.max(0, Math.floor(((view.elapsedMs || 0) + (view.startedAt ? now - view.startedAt : 0)) / 1000));
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const label = ui.pending ? ui.status : view.cancelArmed ? "gesture.cancelRelease" : view.holding ? "gesture.release" : view.mode === "single" ? ui.error ? "dictation.retry" : "dictation.finish" : "dictation.hold";
  return { ...ui, label, elapsed, disabled: ui.pending && !view.holding, timed: ui.recording || view.holding };
}
