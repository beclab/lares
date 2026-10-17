import React from "react";
import { createHoldGesture } from "@olares/lares-core/voice/hold";
import { voiceInputPresentation } from "@olares/lares-core/voice/presentation";
import { useT, messageFor } from "./locale.js";
const h = React.createElement;
export function InlineVoice({ panel }) {
  const view = React.useSyncExternalStore(panel.subscribe, panel.getSnapshot), t = useT();
  const main = React.useRef(null); const [now, setNow] = React.useState(Date.now());
  const act = (name, value) => { void Promise.resolve(panel[name](value)).catch(() => {}); };
  const gesture = React.useMemo(() => createHoldGesture({ start: () => act("holdStart"), end: value => act("holdEnd", value), onCancelChange: value => panel.setCancelArmed(value), isActive: () => panel.getSnapshot().holding }), [panel]);
  React.useEffect(() => {
    if (!view.inputActive) return;
    main.current?.focus(); const clock = setInterval(() => setNow(Date.now()), 250);
    const cancel = () => gesture.cancel(); const hidden = () => { if (document.hidden) { gesture.cancel(); act("pause"); } };
    window.addEventListener("blur", cancel); window.addEventListener("pointerdown", gesture.additionalPointer, true); document.addEventListener("visibilitychange", hidden);
    return () => { clearInterval(clock); gesture.cancel(); window.removeEventListener("blur", cancel); window.removeEventListener("pointerdown", gesture.additionalPointer, true); document.removeEventListener("visibilitychange", hidden); };
  }, [view.inputActive, gesture, panel]);
  if (!view.inputActive) return null;
  const ui = voiceInputPresentation(view, now), continuous = view.mode === "continuous";
  return h("div", { className: "lares-inline-voice", "data-phase": ui.phase, onKeyDown: event => { if (event.key !== "Escape") return; event.preventDefault(); event.stopPropagation(); if (!event.repeat && !gesture.escape()) { act("close"); panel.anchor?.focus?.(); } } },
    view.holding ? h("span", { className: "lares-inline-cancel", "data-armed": view.cancelArmed, "aria-hidden": true }, t(view.cancelArmed ? "gesture.cancelRelease" : "gesture.slideCancel")) : null,
    h("button", { ref: main, type: "button", className: "lares-inline-main", disabled: ui.disabled, "aria-pressed": continuous ? view.holding : undefined, "aria-label": t(ui.label),
      onPointerDown: continuous ? gesture.pointerDown : undefined, onPointerMove: gesture.pointerMove, onPointerUp: gesture.pointerUp, onPointerCancel: gesture.cancel, onLostPointerCapture: gesture.cancel,
      onKeyDown: event => { if (continuous) { gesture.keyDown(event); if (["Space", "Enter"].includes(event.code)) event.stopPropagation(); } }, onKeyUp: continuous ? gesture.keyUp : undefined, onBlur: gesture.cancel,
      onClick: event => { if (!continuous) act(ui.error ? "start" : "finish"); else if (event.detail === 0) gesture.activate(); } },
      !continuous && ui.recording && view.levels.length ? h("svg", { className: "lares-inline-level", viewBox: "0 0 32 24", "aria-hidden": true }, ...view.levels.slice(-6).map((level, index) => h("line", { key: index, x1: index * 5 + 3, x2: index * 5 + 3, y1: 12 - Math.max(2, Math.min(10, level * 500)), y2: 12 + Math.max(2, Math.min(10, level * 500)) }))) : null,
      h("span", null, t(ui.label)), ui.timed ? h("span", { className: "lares-inline-time", "aria-hidden": true }, ` · ${ui.elapsed}`) : null),
    h("span", { className: "lares-inline-status", "data-error": Boolean(ui.error), "data-visible": ["speaking", "working"].includes(ui.phase), role: "status", "aria-live": "polite", "aria-atomic": true }, ui.error ? messageFor(t, ui.error) : t(ui.status)));
}
