import React from "react";
import { voiceDictationPresentation, voiceIndicatorPresentation } from "@olares/lares-core/voice/presentation";
import { useT, messageFor } from "./locale.js";
const h = React.createElement;

export function InlineVoice({ panel }) {
  const view = React.useSyncExternalStore(panel.subscribe, panel.getSnapshot), t = useT();
  const settings = React.useSyncExternalStore(panel.settings.subscribe, panel.settings.getSnapshot);
  const [now, setNow] = React.useState(Date.now());
  const indicator = voiceIndicatorPresentation(view, settings.error);
  const act = operation => { void operation().catch(() => {}); };
  React.useEffect(() => {
    if (!indicator.ticking) return;
    const clock = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(clock);
  }, [indicator.ticking]);
  if (!indicator.visible) return null;
  if (!view.visible) return indicator.error ? h("div", { className: "lares-inline-voice", "data-mode": "single", "data-phase": "error", role: "status" },
    view.readAloudError ? t("settings.readAloudSyncFailed") : messageFor(t, indicator.error), h("button", { type: "button", onClick: () => act(() => view.readAloudError ? panel.retryReadAloud() : panel.settings.refresh()) }, t("dictation.retry"))) : null;
  const ui = voiceDictationPresentation(view, now), continuous = view.mode === "continuous";
  const error = ui.error || view.readAloudError || settings.error;
  if (continuous && !error) return null;
  return h("div", { className: "lares-inline-voice", "data-mode": view.mode, "data-exclusive": ui.exclusive, "data-phase": ui.phase, "data-error": error || undefined },
    continuous ? null : h(React.Fragment, null,
      h("button", { type: "button", className: "lares-dictation-cancel", "aria-label": t("dictation.discard"), onClick: () => act(() => panel.discard()) }, "×"),
      ui.waveform ? h("svg", { className: "lares-dictation-meter", viewBox: "0 0 400 24", preserveAspectRatio: "none", "aria-hidden": true },
        ...Array.from({ length: 40 }, (_, index) => {
          const level = ui.recording ? view.levels[index % Math.max(1, view.levels.length)] || 0 : 0;
          const size = Math.max(1, Math.min(10, level * 500));
          return h("line", { key: index, x1: index * 10 + 5, x2: index * 10 + 5, y1: 12 - size, y2: 12 + size });
        })) : null),
    h("span", { className: "lares-inline-status", role: "status", "aria-live": "polite", "aria-atomic": true }, error ? view.readAloudError ? t("settings.readAloudSyncFailed") : ui.processingFailed ? t("dictation.processingFailed") : messageFor(t, error) : t(ui.status)),
    continuous && error ? h("button", { type: "button", onClick: () => act(() => view.readAloudError ? panel.retryReadAloud() : settings.error ? panel.settings.refresh() : panel.start()) }, t("dictation.retry")) : null,
    !continuous && ui.waveform ? h("span", { className: "lares-inline-time", "aria-hidden": true }, ui.elapsed) : null,
    !continuous && ui.recoverable ? h("div", { className: "lares-dictation-recovery" },
      h("p", { "aria-label": t("dictation.original") }, view.raw),
      h("button", { type: "button", disabled: view.busy && view.stage !== "processing", onClick: () => act(async () => { await panel.selectPreset("raw", true); await panel.complete(); }) }, t("dictation.useOriginal"))) : null);
}
