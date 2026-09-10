const GAP = 5;
const EDGE = 8;

/**
 * Fixed-position style for a panel hanging off `box`. Composer menus sit at the
 * bottom of the window and open upward; the side only flips when the requested
 * one is too cramped to read.
 */
export function placePanel({ box, viewport, width, placement = "bottom-end", minHeight = 120 }) {
  const below = viewport.height - box.bottom - GAP;
  const above = box.top - GAP;
  const preferTop = placement.startsWith("top");
  const wanted = preferTop ? above : below;
  const other = preferTop ? below : above;
  const useTop = preferTop !== (wanted < minHeight && other > wanted);
  const rawLeft = placement.endsWith("start") ? box.left : box.right - width;
  return {
    top: useTop ? "" : `${box.bottom + GAP}px`,
    bottom: useTop ? `${viewport.height - box.top + GAP}px` : "",
    left: `${Math.max(EDGE, Math.min(rawLeft, viewport.width - width - EDGE))}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(minHeight, useTop ? above : below)}px`,
  };
}
