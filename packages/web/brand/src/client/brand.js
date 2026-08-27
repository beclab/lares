import React from "react";
import { PRODUCT_NAME, replaceProductTitle } from "@olares/lares-core/brand/identity";
import { MARK_PATH } from "@olares/lares-core/icons/mark";

const h = React.createElement;

/**
 * Brand occupants for the shell's single-kind brand seats. dsh invites
 * deployments to replace its fish here, so the product mark must not be painted
 * over the shell's own SVGs — a wordmark viewBox change is enough to un-brand a
 * CSS override, and that is exactly what happened on dsh 0.1.1-rc.2.
 */
export function BrandMark({ size = 24 }) {
  return h("img", {
    className: "lares-brand-mark",
    src: MARK_PATH,
    width: size,
    height: size,
    alt: "",
    "aria-hidden": "true",
    draggable: false,
  });
}

/** Sits inside the shell's own `brandName` span, so it inherits its type scale. */
export function BrandName() {
  return h("span", { className: "lares-brand-name" }, PRODUCT_NAME);
}

/**
 * The document title is the one brand surface with no seat and no config: the
 * renderer holds it as a constant and reapplies it per session. Rewriting after
 * each of its writes is the only lever short of patching the package.
 */
export function keepProductTitle() {
  const rebrand = () => {
    const branded = replaceProductTitle(document.title);
    if (branded !== document.title) document.title = branded;
  };
  rebrand();
  const observer = new MutationObserver(rebrand);
  observer.observe(document.head, { subtree: true, childList: true, characterData: true });
  return () => observer.disconnect();
}
