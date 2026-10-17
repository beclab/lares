import React from "react";
import { matchVoiceShortcut } from "@olares/lares-core/voice/shortcuts";
import { voiceAvailability } from "@olares/lares-core/voice/presentation";
import { useT } from "./locale.js";
import micCss from "./styles/mic.css";
export { micCss };
const h = React.createElement;

export function MicButton({ panel, sessionId, inputActions, useInput, mode, onActive = () => {} }) {
  const t = useT();
  const draft = useInput ? useInput(state => state?.draft || "") : "";
  const settings = React.useSyncExternalStore(panel.settings.subscribe, panel.settings.getSnapshot);
  const view = React.useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const trigger = React.useRef(null), opening = React.useRef(false), latest = React.useRef(null);
  const wasDictating = React.useRef(false);
  const dictating = view.visible && view.mode === "single";
  React.useEffect(() => {
    if (wasDictating.current && !dictating && panel.target?.sessionId === (sessionId || null)) inputActions?.focus();
    wasDictating.current = dictating;
  }, [dictating, inputActions, panel, sessionId]);
  panel.target = { sessionId: sessionId || null, inputActions, draft, mode };
  const open = async preset => {
    if (opening.current || panel.getSnapshot().busy) return;
    opening.current = true; panel.anchor = trigger.current;
    try {
      const value = await panel.settings.refresh();
      if (document.hidden || navigator.onLine === false || panel.target?.sessionId !== (sessionId || null) || !voiceAvailability(value).dictation) return;
      await panel.open({ mode: "single", sessionId: sessionId || null, preset });
    } finally { opening.current = false; }
  };
  latest.current = { open, settings };
  React.useEffect(() => { void panel.bind(sessionId || null).catch(() => {}); }, [sessionId, panel]);
  React.useEffect(() => { onActive(["open", "paused"].includes(view.snapshot?.connection)); }, [view.snapshot?.connection]);
  React.useEffect(() => {
    const refresh = () => { void panel.settings.refresh().then(value => {
      const state = panel.getSnapshot();
      if (state.visible && state.mode === "continuous" && !voiceAvailability(value).conversation) return panel.close();
    }).catch(() => {}); };
    const pause = () => { if (panel.getSnapshot().visible) void panel.pause().catch(() => {}); };
    const hidden = () => { if (document.hidden) pause(); };
    const keydown = event => {
      const state = panel.getSnapshot();
      if (event.key === "Escape" && state.visible) { event.preventDefault(); event.stopPropagation(); if (!event.repeat) void (state.mode === "single" ? panel.close() : panel.pause()).catch(() => {}); return; }
      const action = matchVoiceShortcut(event, latest.current.settings.value?.config?.dictationShortcuts);
      if (!action || !voiceAvailability(latest.current.settings.value).dictation) return;
      event.preventDefault();
      if (state.busy) return;
      if (state.visible && state.mode === "single") { if (state.snapshot?.capture === "recording") void panel.finish().catch(() => {}); return; }
      void latest.current.open(action === "default" ? undefined : action).catch(() => {});
    };
    refresh(); window.addEventListener("lares-voice-settings", refresh); window.addEventListener("keydown", keydown, true);
    document.addEventListener("visibilitychange", hidden); window.addEventListener("offline", pause);
    return () => { window.removeEventListener("lares-voice-settings", refresh); window.removeEventListener("keydown", keydown, true); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("offline", pause); };
  }, [panel]);
  if (!voiceAvailability(settings.value).dictation) return null;
  return h("span", { className: "lares-voice-entries" }, h("button", {
    ref: trigger, type: "button", disabled: view.busy || view.visible && view.mode === "single",
    onClick: () => { void open().catch(() => {}); }, "aria-label": t("settings.mode.single"), title: t("settings.mode.single"),
  }, h("svg", { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", "aria-hidden": true },
    h("rect", { x: 9, y: 2, width: 6, height: 12, rx: 3 }), h("path", { d: "M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" }))));
}
