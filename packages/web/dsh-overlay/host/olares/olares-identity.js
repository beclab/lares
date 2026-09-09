/**
 * Edge identity → olares-cli profile + treat authenticated /api as loopback.
 * dsh locks config/LLM discover to loopback; Olares entrance (Authelia) is that auth layer.
 */
import { identityFromHeaders } from "@olares/lares-core/olares/identity";
import { rememberRequestIdentity } from "@olares/lares-core/olares/session-identity";
import {
  applyLoopbackHeaders,
  loopbackAuthority,
  shouldRewriteApiLoopback,
  trustedEntranceHosts,
} from "@olares/lares-core/olares/trusted-host";

export const name = "lares-olares-identity";
export const inject = ["webServer"];

/**
 * A WebSocket handshake arrives as `upgrade`, never as `request`, so listening
 * on `request` alone leaves the mux socket unrewritten: it reaches dsh's origin
 * fence still carrying the host page's own origin — `file://` for a packaged
 * LarePass build — and is refused with 403, while every plain `/api` call on
 * the same entrance succeeds.
 */
const SERVER_EVENTS = ["request", "upgrade"];

/** One line per distinct cause; the broken path repeats on every reconnect. */
const warned = new Set();
function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

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
      if (!shouldRewriteApiLoopback(req, trustedEntranceHosts())) return;
      if (!edgeAuthenticated) {
        // Reached the entrance but the edge sent no usable identity, so the
        // rewrite is skipped and dsh answers 403. Silent until now, which is
        // why this was indistinguishable from an authentication failure.
        warnOnce(
          `[lares] entrance /api without edge identity: user=${identity.user ? "yes" : "no"} token=${identity.token ? "yes" : "no"}`,
        );
        return;
      }
      applyLoopbackHeaders(req.headers, loopbackAuthority(ctx.webServer.port));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[lares] olares identity skipped: ${message}`);
    }
  };

  const detach = () => {
    if (attached) {
      for (const event of SERVER_EVENTS) attached.off(event, onRequest);
    }
    attached = undefined;
  };

  const attach = () => {
    // WebServer keeps the node:http server on a TS-private field; readable from JS.
    const server = /** @type {{ server?: import('node:http').Server }} */ (ctx.webServer).server;
    if (!server || server === attached) return Boolean(server);
    detach();
    for (const event of SERVER_EVENTS) server.prependListener(event, onRequest);
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
