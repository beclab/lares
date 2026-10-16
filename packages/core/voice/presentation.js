/** Stable status keys keep waveform/timer updates out of live announcements. */
export function voicePanelPresentation(view) {
  const capture = view.snapshot?.capture;
  const processing = view.stage === "processing";
  const transcribing = capture === "transcribing";
  const preview = view.mode === "single" && ["preview", "processing"].includes(view.stage);
  const preparing = view.busy || capture === "recording" && view.snapshot?.inputReady === false;
  const recording = capture === "recording" && !preparing;
  const error = view.error || view.snapshot?.error;
  const phase = view.cancelArmed ? "cancel" : error ? "error" : processing ? "processing" : transcribing ? "transcribing" : preparing ? "preparing" : recording ? "recording" : preview ? "preview" : view.snapshot && view.snapshot.playback !== "idle" ? "speaking" : "waiting";
  const status = error ? `error.${error}` : ({ cancel: "gesture.cancelRelease", processing: "dictation.processing", transcribing: "mic.transcribing", preparing: "mic.preparing", recording: "call.listening", preview: "dictation.preview", speaking: "dictation.speaking", waiting: view.mode === "continuous" ? "gesture.waiting" : "dictation.preview" })[phase];
  return { phase, status, preview, recording, pending: processing || transcribing || preparing, error };
}
