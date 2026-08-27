/**
 * Olares serves the LAN zone (<prefix>.<user>.olares.local) over plain http, and
 * browsers withhold `crypto.randomUUID` on insecure origins. dsh's client mints
 * host-RPC and message ids with it, so `api.host.*` calls — the workspace
 * directory picker first — throw there.
 *
 * Injected into <head> ahead of the shell bundle so every client module, ours or
 * a community one, sees the same identity source.
 */
import { injectUuidShim } from "@olares/lares-core/tools/crypto-uuid";

export { UUID_SHIM, injectUuidShim } from "@olares/lares-core/tools/crypto-uuid";

export const name = "lares-crypto-uuid";
export const inject = ["webServer"];

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.tapIndex(injectUuidShim), "lares-crypto-uuid");
}
