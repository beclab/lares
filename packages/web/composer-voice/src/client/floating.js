export function voicePanelPosition({ anchor, width, height, viewport }) {
  const { left = 0, top = 0, width: vw, height: vh } = viewport;
  const pad = 12, right = left + vw, bottom = top + vh;
  if (vw < 600) return { left, top: Math.max(top, bottom - height) };
  const x = anchor ? anchor.right - width : left + (vw - width) / 2;
  const above = anchor ? anchor.top - height - 12 : bottom - height - pad;
  const y = anchor && above < top + pad && anchor.bottom + 12 + height <= bottom - pad ? anchor.bottom + 12 : above;
  return { left: Math.max(left + pad, Math.min(x, right - width - pad)), top: Math.max(top + pad, Math.min(y, bottom - height - pad)) };
}

export function followVoiceAnchor(dialog, getAnchor) {
  const viewport = window.visualViewport;
  const place = () => {
    const box = { left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0, width: viewport?.width || window.innerWidth, height: viewport?.height || window.innerHeight };
    dialog.style.setProperty("--voice-view-height", `${box.height}px`);
    dialog.style.setProperty("--voice-view-width", `${box.width}px`);
    const anchor = getAnchor();
    const point = voicePanelPosition({ anchor: anchor?.isConnected ? anchor.getBoundingClientRect() : null, width: dialog.offsetWidth, height: dialog.offsetHeight, viewport: box });
    dialog.style.left = `${point.left}px`; dialog.style.top = `${point.top}px`;
  };
  const resize = new ResizeObserver(place); resize.observe(dialog);
  const anchor = getAnchor(); if (anchor?.isConnected) resize.observe(anchor);
  window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
  viewport?.addEventListener("resize", place); viewport?.addEventListener("scroll", place); place();
  return () => { resize.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); viewport?.removeEventListener("resize", place); viewport?.removeEventListener("scroll", place); };
}
