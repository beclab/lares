/** Pointer selection is shared across clients; no DOM objects are retained. */
export function createHoldGesture({ start, end, onCancelChange = () => {}, isActive = () => false }) {
  let pointer = null, top = 0, keyboard = null, armed = false;
  const select = (value) => {
    if (armed === value) return;
    armed = value; onCancelChange(value);
  };
  const finish = (cancel) => {
    const active = pointer !== null || keyboard !== null || isActive();
    pointer = null; keyboard = null; select(false);
    if (active) end(cancel);
    return active;
  };
  const move = (event) => {
    if (pointer !== event.pointerId) return;
    const distance = top - event.clientY;
    if (distance >= 60) select(true);
    else if (distance < 40) select(false);
  };
  const activate = () => {
    if (pointer !== null || keyboard !== null || isActive()) { finish(false); return; }
    keyboard = "toggle"; start();
  };
  return {
    pointerDown(event) {
      if (pointer !== null) { if (event.pointerId !== pointer) finish(true); return; }
      if (keyboard !== null || event.isPrimary === false || event.button !== 0) return;
      event.preventDefault(); pointer = event.pointerId; top = event.clientY;
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { finish(true); return; }
      start();
    },
    additionalPointer(event) { if (pointer !== null && pointer !== event.pointerId) finish(true); },
    pointerMove: move,
    pointerUp(event) { if (pointer !== event.pointerId) return; event.preventDefault(); move(event); finish(armed); },
    cancel(event) {
      if (typeof event?.pointerId === "number" && pointer !== event.pointerId) return;
      finish(true);
    },
    escape: () => finish(true),
    activate,
    keyDown(event) {
      if (!["Space", "Enter"].includes(event.code)) return;
      event.preventDefault();
      if (event.repeat) return;
      if (event.code === "Enter") { activate(); return; }
      if (pointer !== null || keyboard !== null || isActive()) return;
      keyboard = "space"; start();
    },
    keyUp(event) { if (event.code !== "Space") return; event.preventDefault(); if (keyboard === "space") finish(false); },
  };
}
