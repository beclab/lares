import React from "react";
import { matchVoiceShortcut } from "@olares/lares-core/voice/shortcuts";
import { laresVoiceAvailability } from "@olares/lares-core/voice/lares-policy";
import { voiceAvailability } from "@olares/lares-core/voice/presentation";
import { useT } from "./locale.js";
import micCss from "./styles/mic.css";
import { watchCatalogRevision } from "../../../shared/client/catalog-events.js";
import { recordVoiceStartup } from "@olares/lares-core/voice/startup";
export { micCss };
const h = React.createElement;

export function MicButton({ panel, sessionId, inputActions, useInput, mode, onActive = () => {} }) {
  const t = useT();
  const draft = useInput ? useInput(state => state?.draft || "") : "";
  const settings = React.useSyncExternalStore(panel.settings.subscribe, panel.settings.getSnapshot);
  const view = React.useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const trigger = React.useRef(null), opening = React.useRef(false), latest = React.useRef(null);
  const wasDictating = React.useRef(false);
  const mountedAt = React.useRef(performance.now());
  const dictating = view.visible && view.mode === "single";
  React.useEffect(() => { recordVoiceStartup("entrance", performance.now() - mountedAt.current); }, []);
  React.useEffect(() => {
    if (dictating && panel.startupAt != null) recordVoiceStartup("feedback", performance.now() - panel.startupAt);
  }, [dictating, panel]);
  React.useEffect(() => {
    if (wasDictating.current && !dictating && panel.target?.sessionId === (sessionId || null)) {
      trigger.current?.closest("[data-composer-card]")?.querySelector('[contenteditable="true"]')?.focus({ preventScroll: true });
    }
    wasDictating.current = dictating;
  }, [dictating, inputActions, panel, sessionId]);
  panel.target = { sessionId: sessionId || null, inputActions, draft, mode };
  const open = async preset => {
    panel.arm();
    if (opening.current || panel.getSnapshot().busy) return;
    opening.current = true; panel.anchor = trigger.current;
    panel.startupAt = performance.now();
    try {
      const value = panel.settings.getSnapshot().value;
      if (document.hidden || navigator.onLine === false || panel.target?.sessionId !== (sessionId || null) || !voiceAvailability(value).dictation) return;
      await panel.open({ mode: "single", sessionId: sessionId || null, preset, configSnapshot: value.config });
    } finally { opening.current = false; }
  };
  latest.current = { open, settings };
  React.useEffect(() => { void panel.bind(sessionId || null).catch(() => {}); }, [sessionId, panel]);
  React.useEffect(() => { onActive(["open", "paused"].includes(view.snapshot?.connection)); }, [view.snapshot?.connection]);
  React.useEffect(() => {
    const refresh = (event) => { void panel.settings.refresh({ force: event?.type === "lares-voice-catalog" }).then(value => {
      const state = panel.getSnapshot();
      if (state.visible && state.mode === "continuous" && !laresVoiceAvailability(value, panel.agentAvailable).conversation) return panel.close();
    }).catch(() => {}); };
    const pause = () => { if (panel.getSnapshot().visible) void panel.pause().catch(() => {}); };
    const hidden = () => { if (document.hidden) pause(); };
    const keydown = event => {
      if (event.composedPath?.().some(node => node?.hasAttribute?.("data-voice-shortcut-recorder"))) return;
      const state = panel.getSnapshot();
      if (event.key === "Escape" && state.visible) { event.preventDefault(); event.stopPropagation(); if (!event.repeat) void (state.mode === "single" ? panel.close() : panel.pause()).catch(() => {}); return; }
      const action = matchVoiceShortcut(event, latest.current.settings.value?.config?.dictationShortcuts);
      if (!action || !voiceAvailability(latest.current.settings.value).dictation) return;
      event.preventDefault();
      if (state.busy) return;
      if (state.visible && state.mode === "single") { if (state.snapshot?.capture === "recording") void panel.finish().catch(() => {}); return; }
      void latest.current.open(action === "default" ? undefined : action).catch(() => {});
    };
    refresh(); window.addEventListener("lares-voice-settings", refresh); window.addEventListener("lares-voice-catalog", refresh); window.addEventListener("keydown", keydown, true);
    const stopCatalog = watchCatalogRevision(() => refresh({ type: "lares-voice-catalog" }));
    document.addEventListener("visibilitychange", hidden); window.addEventListener("offline", pause);
    return () => { stopCatalog(); window.removeEventListener("lares-voice-settings", refresh); window.removeEventListener("lares-voice-catalog", refresh); window.removeEventListener("keydown", keydown, true); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("offline", pause); };
  }, [panel]);
  const checking = !settings.value;
  if (!checking && !voiceAvailability(settings.value).dictation) return null;
  const label = t(checking ? settings.error ? "settings.loadFailed" : "mic.checking" : "settings.mode.single");
  return h("span", { className: "lares-voice-entries" }, h("button", {
    ref: trigger, type: "button", disabled: checking || view.busy || view.visible && view.mode === "single",
    onClick: () => { void open().catch(() => {}); }, "aria-label": label, title: label,
  }, h("svg", { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", "aria-hidden": true },
    h("rect", { x: 9, y: 2, width: 6, height: 12, rx: 3 }), h("path", { d: "M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" }))));
}
