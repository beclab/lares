/**
 * Olares serves the LAN zone (<prefix>.<user>.olares.local) over plain http, and
 * browsers withhold `crypto.randomUUID` on insecure origins. dsh's client mints
 * host-RPC and message ids with it, so `api.host.*` calls — the workspace
 * directory picker first — throw there. `getRandomValues` stays available on
 * insecure origins, which is the same source upstream's own UUID fallback uses.
 *
 * Injected into <head> ahead of the shell bundle so every client module, ours or
 * a community one, sees the same identity source.
 */
export const name = "lares-crypto-uuid";
export const inject = ["webServer"];

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

const HEAD_OPEN = /<head[^>]*>/i;

/**
 * @param {string} html
 * @returns {string} html whose first script is the shim
 */
export function injectUuidShim(html) {
  if (html.includes("data-lares-uuid-shim")) return html;
  const tag = `<script data-lares-uuid-shim>${UUID_SHIM}</script>`;
  const head = HEAD_OPEN.exec(html);
  return head === null ? `${tag}${html}` : html.replace(HEAD_OPEN, `${head[0]}${tag}`);
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.tapIndex(injectUuidShim), "lares-crypto-uuid");
}
