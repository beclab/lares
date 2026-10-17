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

/** Discovery establishes capability; a transient connection error does not revoke it. */
export function voiceAvailability(settings) {
  if (!settings) return { dictation: false, conversation: false, reason: "loading" };
  const config = settings.config || {};
  const available = (models, selected) => Array.isArray(models) && models.length > 0 && (!selected || models.includes(selected));
  const dictation = available(settings.sttModels, config.model);
  const chat = config.preset === "direct" || available(settings.chatModels, config.chatModel === "default-chat" ? "" : config.chatModel);
  const pipeline = dictation && available(settings.ttsModels, config.ttsModel) && chat;
  // Automatic turns against native Realtime still require independent acceptance.
  return { dictation, conversation: config.backend !== "realtime" && pipeline, reason: !dictation ? "asr" : !pipeline ? "conversation" : config.backend === "realtime" ? "realtime" : null };
}

export function voicePrimaryAction({ view, available, empty, running, disabled = false, nativeDisabled = false }) {
  if (view.visible && view.mode === "single") return { action: view.error || view.snapshot?.error ? "retry" : "finish", disabled: disabled || view.busy || view.stage === "processing" || view.snapshot?.capture === "transcribing" };
  if (!empty) return { action: "native", disabled: nativeDisabled };
  if (view.visible && view.mode === "continuous") {
    const active = view.busy || view.snapshot?.connection === "open";
    return { action: active ? "pause" : available ? "resume" : "native", disabled: disabled || !active && !available };
  }
  if (running) return { action: "native", disabled: nativeDisabled };
  return { action: available ? "conversation" : "native", disabled: disabled || !available };
}
