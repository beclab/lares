import React from "react";
import { voiceDictationPresentation } from "@olares/lares-core/voice/presentation";
import { useT, messageFor } from "./locale.js";
const h = React.createElement;

export function InlineVoice({ panel }) {
  const view = React.useSyncExternalStore(panel.subscribe, panel.getSnapshot), t = useT();
  const settings = React.useSyncExternalStore(panel.settings.subscribe, panel.settings.getSnapshot);
  const [now, setNow] = React.useState(Date.now());
  const act = operation => { void operation().catch(() => {}); };
  React.useEffect(() => {
    if (!view.visible) return;
    const clock = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(clock);
  }, [view.visible]);
  if (!view.visible) return settings.error ? h("div", { className: "lares-inline-voice", "data-mode": "single", "data-phase": "error", role: "status" },
    messageFor(t, settings.error), h("button", { type: "button", onClick: () => act(() => panel.settings.refresh()) }, t("dictation.retry"))) : null;
  const ui = voiceDictationPresentation(view, now), continuous = view.mode === "continuous";
  const paused = ["paused", "closed"].includes(view.snapshot?.connection);
  const status = continuous ? t(paused ? "pc.paused" : ui.phase === "speaking" ? "pc.speaking" : ui.phase === "working" ? "call.working" : ui.phase === "recording" ? "call.listening" : ui.status) : t(ui.status);
  const error = view.error || view.snapshot?.error || settings.error;
  return h("div", { className: "lares-inline-voice", "data-mode": view.mode, "data-exclusive": ui.exclusive, "data-phase": continuous && paused ? "paused" : ui.phase, "data-error": error || undefined },
    continuous ? h("div", { className: "lares-voice-orb", "aria-hidden": true }) : h(React.Fragment, null,
      h("button", { type: "button", className: "lares-dictation-cancel", "aria-label": t("dictation.discard"), onClick: () => act(() => panel.discard()) }, "×"),
      ui.waveform ? h("svg", { className: "lares-dictation-meter", viewBox: "0 0 400 24", preserveAspectRatio: "none", "aria-hidden": true },
        ...Array.from({ length: 40 }, (_, index) => {
          const level = ui.recording ? view.levels[index % Math.max(1, view.levels.length)] || 0 : 0;
          const size = Math.max(1, Math.min(10, level * 500));
          return h("line", { key: index, x1: index * 10 + 5, x2: index * 10 + 5, y1: 12 - size, y2: 12 + size });
        })) : null),
    h("span", { className: "lares-inline-status", role: "status", "aria-live": "polite", "aria-atomic": true }, error ? ui.processingFailed ? t("dictation.processingFailed") : messageFor(t, error) : status),
    !continuous && ui.waveform ? h("span", { className: "lares-inline-time", "aria-hidden": true }, ui.elapsed) : null,
    !continuous && ui.recoverable ? h("div", { className: "lares-dictation-recovery" },
      h("p", { "aria-label": t("dictation.original") }, view.raw),
      h("button", { type: "button", disabled: view.busy && view.stage !== "processing", onClick: () => act(async () => { await panel.selectPreset("raw", true); await panel.complete(); }) }, t("dictation.useOriginal"))) : null);
}
