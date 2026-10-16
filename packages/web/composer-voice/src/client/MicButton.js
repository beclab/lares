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
  panel.target = { sessionId: sessionId || null, inputActions, draft, mode };
  const open = async (choice, preset) => {
    const settings = await loadVoiceSettings({ force: true }); setConfig(settings.config);
    await panel.open({ mode: choice || settings.config.mode, sessionId: sessionId || null, preset });
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
    h("button", { type: "button", onClick: () => { void open().catch(() => {}); }, "aria-haspopup": "dialog", title: t(`settings.mode.${config.mode}`) }, t(config.mode === "continuous" ? "call.start" : "mic.idle")),
    view.snapshot?.connection === "paused" ? h("span", { role: "status" }, t("panel.paused")) : null);
}
