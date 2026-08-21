import React from "react";

const h = React.createElement;

/** Olares has no Host settings.yaml surface. */
export function HideOpenDocument() {
  return null;
}

/** Retire stats line but keep its 24px bottom clearance under the card. */
export function RetireStatsLine() {
  return h("div", { className: "dina-stats-clearance", "aria-hidden": "true" });
}

export function HideModelSeat() {
  return null;
}
