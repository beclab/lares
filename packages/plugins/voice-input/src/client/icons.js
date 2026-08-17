import React from "react";
import { IconLoadingOutline16 } from "@deepseek-ai/dsh-client-ui-primitives";
import spinCss from "./styles/spin.css";

const h = React.createElement;

export { spinCss };

/** IconLoadingOutline16 is a static glyph; the rotation is ours (spin.css). */
export function Spinner(size) {
  return h(IconLoadingOutline16, { size, className: "dina-voice-spin" });
}

export function MicGlyph() {
  return h(
    "svg",
    { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
    h("rect", { x: 9, y: 3, width: 6, height: 11, rx: 3, fill: "currentColor" }),
    h("path", {
      d: "M6 11a6 6 0 0 0 12 0M12 17v3",
      stroke: "currentColor",
      strokeWidth: 1.6,
      strokeLinecap: "round",
      fill: "none",
    }),
  );
}
