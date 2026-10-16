export function createHoldGesture({ start, end }) {
  let pointer = null, top = 0, keyboard = false;
  const cancel = () => { if (pointer !== null || keyboard) { pointer = null; keyboard = false; end(true); } };
  return {
    pointerDown(event) { if (pointer !== null || event.isPrimary === false || event.button !== 0) return; event.preventDefault(); pointer = event.pointerId; top = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); start(); },
    pointerUp(event) { if (pointer !== event.pointerId) return; event.preventDefault(); pointer = null; end(event.clientY < top - 60); },
    cancel,
    keyDown(event) { if (event.code !== "Space" || event.repeat) return; event.preventDefault(); keyboard = true; start(); },
    keyUp(event) { if (event.code !== "Space" || !keyboard) return; event.preventDefault(); keyboard = false; end(false); },
  };
}
