import { injectHeadScript } from "./head-script.js";

/**
 * Olares LAN zone is plain http, so browsers withhold `crypto.randomUUID`.
 * dsh mints host-RPC ids with it; `getRandomValues` stays available.
 */
export const UUID_SHIM = `(function () {
  var c = globalThis.crypto;
  if (c === undefined || typeof c.randomUUID === "function") return;
  c.randomUUID = function randomUUID() {
    var bytes = c.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.from(bytes, function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
  };
})();`;

export function injectUuidShim(html) {
  return injectHeadScript(html, { marker: "data-lares-uuid-shim", code: UUID_SHIM });
}
