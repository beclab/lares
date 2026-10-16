import React from "react";
import { useT } from "./locale.js";
import micCss from "./styles/mic.css";
export { micCss };
const h = React.createElement;
export function MicButton({ panel, sessionId, inputActions, useInput, mode, onActive = () => {} }) {
  const t = useT();
  const draft = useInput ? useInput((state) => state?.draft || "") : "";
  const view = React.useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  React.useEffect(() => { void panel.bind(sessionId || null).catch(() => {}); }, [sessionId, panel]);
  React.useEffect(() => { onActive(view.snapshot?.connection === "open" || view.snapshot?.connection === "paused"); }, [view.snapshot?.connection]);
  const open = (choice) => {
    panel.target = { sessionId: sessionId || null, inputActions, draft, mode };
    void panel.open({ mode: choice, sessionId: sessionId || null }).catch(() => {});
  };
  // Read the current draft at completion, never replace text captured when the panel opened.
  panel.target = { sessionId: sessionId || null, inputActions, draft, mode };
  return h("span", { className: "lares-voice-entries" },
    h("button", { type: "button", onClick: () => open("single"), "aria-haspopup": "dialog" }, t("mic.idle")),
    h("button", { type: "button", onClick: () => open("continuous"), "aria-haspopup": "dialog" }, t("call.start")),
    view.snapshot?.connection === "paused" ? h("span", { role: "status" }, t("panel.paused")) : null);
}
