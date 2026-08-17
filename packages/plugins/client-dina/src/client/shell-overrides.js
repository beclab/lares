import React, { useEffect } from "react";

const h = React.createElement;

/** Shadow welcome-notice (priority -1) — hide DeepSeek Harness internal-testing step. */
export function RetireWelcomeNotice({ complete }) {
  useEffect(() => {
    complete();
  }, [complete]);
  return null;
}

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
