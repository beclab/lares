import React from "react";
import { loadVoiceSettings } from "@olares/lares-core/voice/client";
import { matchVoiceShortcut } from "@olares/lares-core/voice/shortcuts";
import { useT } from "./locale.js";
import micCss from "./styles/mic.css";
export { micCss };
const h = React.createElement;
export function MicButton({ panel, sessionId, inputActions, useInput, mode, onActive = () => {} }) {
  const t = useT();
  const draft = useInput ? useInput((state) => state?.draft || "") : "";
  const [config, setConfig] = React.useState({ mode: "single" });
  const view = React.useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const latest = React.useRef(null);
  const trigger = React.useRef(null), opening = React.useRef(false);
  panel.target = { sessionId: sessionId || null, inputActions, draft, mode };
  const open = async (choice, preset) => {
    if (opening.current) return;
    opening.current = true; panel.anchor = trigger.current;
    try {
      const settings = await loadVoiceSettings({ force: true }); setConfig(settings.config);
      const state = panel.getSnapshot();
      await panel.open({ mode: state.mode === "single" && state.raw ? "single" : choice || settings.config.mode, sessionId: sessionId || null, preset });
    } finally { opening.current = false; }
  };
  latest.current = { open, config, sessionId };
  React.useEffect(() => { void panel.bind(sessionId || null).catch(() => {}); }, [sessionId, panel]);
  React.useEffect(() => { onActive(view.snapshot?.connection === "open" || view.snapshot?.connection === "paused"); }, [view.snapshot?.connection]);
  React.useEffect(() => {
    let alive = true;
    const refresh = () => { void loadVoiceSettings({ force: true }).then((value) => { if (alive) setConfig(value.config); }).catch(() => {}); };
    refresh(); window.addEventListener("lares-voice-settings", refresh);
    const keydown = (event) => {
      const action = matchVoiceShortcut(event, latest.current.config.dictationShortcuts);
      if (!action) return;
      event.preventDefault(); const state = panel.getSnapshot();
      if (state.busy) return;
      if (state.visible || state.raw) { if (state.mode === "single" && state.snapshot?.capture === "recording") void panel.finish().catch(() => {}); return; }
      void latest.current.open("single", action === "default" ? undefined : action).catch(() => {});
    };
    window.addEventListener("keydown", keydown);
    return () => { alive = false; window.removeEventListener("keydown", keydown); window.removeEventListener("lares-voice-settings", refresh); };
  }, [panel]);
  return h("span", { className: "lares-voice-entries" },
    h("button", { ref: trigger, type: "button", onClick: () => {
      if (view.inputActive) { void panel.close().catch(() => {}); requestAnimationFrame(() => inputActions?.focus?.()); }
      else void open().catch(() => {});
    }, "aria-expanded": view.inputActive || view.previewVisible, "aria-label": t(view.inputActive ? "input.keyboard" : `settings.mode.${config.mode}`), title: t(view.inputActive ? "input.keyboard" : `settings.mode.${config.mode}`) },
    h("svg", { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", "aria-hidden": true }, view.inputActive
      ? h(React.Fragment, null, h("rect", { x: 3, y: 5, width: 18, height: 14, rx: 3 }), h("path", { d: "M7 9h1m3 0h1m3 0h1M7 12h1m3 0h1m3 0h1M8 15h8" }))
      : h("path", { d: "M5 8v8M12 5v14M19 8v8" }))));
}
