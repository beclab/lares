import React from "react";
import { requireComposerModel, modelState } from "@olares/lares-core/router/model-state";
import { laresVoiceAvailability } from "@olares/lares-core/voice/lares-policy";
import { voicePrimaryAction } from "@olares/lares-core/voice/presentation";
import { useT } from "./locale.js";
const h = React.createElement;

export function VoicePrimary({ panel, nativePrimary, empty, running, disabled, nativeDisabled, inputActions, sessionId, agentDirectory, loadAgent }) {
  const t = useT();
  const view = React.useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const settings = React.useSyncExternalStore(panel.settings.subscribe, panel.settings.getSnapshot);
  const opening = React.useRef(false);
  const agent = React.useSyncExternalStore(agentDirectory.subscribe, agentDirectory.getSnapshot);
  panel.agentAvailable = modelState(agent).valid;
  React.useEffect(() => { void loadAgent().catch(() => {}); }, [loadAgent]);
  React.useEffect(() => inputActions?.bindBeforeSubmit?.(async () => {
    panel.arm();
    requireComposerModel(agentDirectory.getSnapshot(), document.documentElement.lang);
    const current = panel.getSnapshot();
    if (current.visible && current.mode === "single") throw new Error(t("pc.finishFirst"));
    if (current.mode === "continuous" && current.snapshot?.connection !== "open") await panel.openReadout();
    else if (current.visible && current.mode === "continuous") await panel.pause();
  }), [panel, inputActions, t, agentDirectory]);
  const choice = voicePrimaryAction({ view, available: laresVoiceAvailability(settings.value, panel.agentAvailable).conversation, empty, running, disabled, nativeDisabled });
  if (choice.action === "native") return nativePrimary;
  const act = async () => {
    panel.arm();
    if (choice.action === "pause") return panel.pause();
    if (opening.current) return;
    opening.current = true;
    try {
      if (choice.action === "finish") await panel.finish();
      else if (choice.action === "resume") {
        const current = await panel.settings.refresh();
        if (!document.hidden && navigator.onLine !== false && panel.target?.sessionId === (sessionId || null) && laresVoiceAvailability(current, modelState(agentDirectory.getSnapshot()).valid).conversation) await panel.start();
      } else if (choice.action === "retry") {
        if (view.raw) { await panel.selectPreset(view.preset, true); if (!panel.getSnapshot().error) await panel.complete(); }
        else await panel.start();
      } else {
        const current = await panel.settings.refresh();
        if (document.hidden || navigator.onLine === false || panel.target?.sessionId !== (sessionId || null) || !laresVoiceAvailability(current, modelState(agentDirectory.getSnapshot()).valid).conversation) return;
        await panel.open({ mode: "continuous", sessionId: sessionId || null }); await panel.start();
      }
    } finally { opening.current = false; }
  };
  const label = t(`pc.${choice.action}`);
  return h("button", { type: "button", className: "lares-voice-primary", "data-action": choice.action, disabled: choice.disabled, "aria-label": label, title: label,
    onClick: () => { void act().catch(() => {}); } },
    h("svg", { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", "aria-hidden": true },
      choice.disabled ? h("circle", { cx: 12, cy: 12, r: 8, strokeDasharray: "30 20", className: "lares-voice-spinner" })
        : choice.action === "pause" ? h("path", { d: "M9 5v14M15 5v14" })
          : choice.action === "finish" ? h("rect", { x: 6, y: 6, width: 12, height: 12, rx: 2, fill: "currentColor", stroke: "none" })
            : choice.action === "retry" ? h("path", { d: "M4 12a8 8 0 1 0 2-5M4 4v5h5" })
              : h("path", { d: "M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" })));
}
