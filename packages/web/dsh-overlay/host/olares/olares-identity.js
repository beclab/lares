/**
 * Edge identity → olares-cli profile + treat authenticated /api as loopback.
 * dsh locks config/LLM discover to loopback; Olares entrance (Authelia) is that auth layer.
 */
import { identityFromHeaders } from "@lares/core/olares/identity";
import { rememberRequestIdentity } from "@lares/core/olares/session-identity";
import {
  applyLoopbackHeaders,
  loopbackAuthority,
  shouldRewriteApiLoopback,
  trustedEntranceHosts,
} from "@lares/core/olares/trusted-host";

export const name = "lares-olares-identity";
export const inject = ["webServer"];

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  /** @type {import('node:http').Server | undefined} */
  let attached;

  /** @param {import('node:http').IncomingMessage} req */
  const onRequest = (req) => {
    try {
      const identity = identityFromHeaders(req.headers ?? {});
      const edgeAuthenticated = Boolean(identity.user && identity.token);
      if (edgeAuthenticated) rememberRequestIdentity(identity);
      if (!edgeAuthenticated || !shouldRewriteApiLoopback(req, trustedEntranceHosts())) return;
      applyLoopbackHeaders(req.headers, loopbackAuthority(ctx.webServer.port));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[lares] olares identity skipped: ${message}`);
    }
  };

  const detach = () => {
    if (attached) attached.off("request", onRequest);
    attached = undefined;
  };

  const attach = () => {
    // WebServer keeps the node:http server on a TS-private field; readable from JS.
    const server = /** @type {{ server?: import('node:http').Server }} */ (ctx.webServer).server;
    if (!server || server === attached) return Boolean(server);
    detach();
    server.prependListener("request", onRequest);
    attached = server;
    return true;
  };

  if (attach()) {
    ctx.effect(() => detach, "lares-olares-identity");
    return;
  }

  const timer = setInterval(() => {
    if (attach()) clearInterval(timer);
  }, 50);
  ctx.effect(
    () => () => {
      clearInterval(timer);
      detach();
    },
    "lares-olares-identity",
  );
}
