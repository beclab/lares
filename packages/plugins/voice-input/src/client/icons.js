import React from "react";
import { IconLoadingOutline16 } from "@deepseek-ai/dsh-client-ui-primitives";
import spinCss from "./styles/spin.css";

const h = React.createElement;

export { spinCss };

/** IconLoadingOutline16 is a static glyph; the rotation is ours (spin.css). */
export function Spinner(size) {
  return h(IconLoadingOutline16, { size, className: "dina-voice-spin" });
}

/** Sized on the ic_ds_* 16-grid so it carries the same visual weight in a row of them. */
export function MicGlyph({ size = 16, className } = {}) {
  return h(
    "svg",
    { width: size, height: size, className, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
    h("rect", { x: 5.75, y: 1.25, width: 4.5, height: 8, rx: 2.25, fill: "currentColor" }),
    h("path", {
      d: "M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12.25v2.25",
      stroke: "currentColor",
      strokeWidth: 1.4,
      strokeLinecap: "round",
      fill: "none",
    }),
  );
}
