/**
 * Edge identity → olares-cli profile + treat entrance traffic as loopback.
 * dsh locks config/LLM discover to loopback; the Olares entrance is that auth
 * layer, at whatever level the user set it to.
 */
import { identityFromHeaders } from "@olares/lares-core/olares/identity";
import { rememberRequestIdentity } from "@olares/lares-core/olares/session-identity";
import {
  applyLoopbackHeaders,
  loopbackAuthority,
  viaOlaresEntrance,
} from "@olares/lares-core/olares/trusted-host";

export const name = "lares-olares-identity";
export const inject = ["webServer", "connection"];

/**
 * A WebSocket handshake arrives as `upgrade`, never as `request`, so listening
 * on `request` alone leaves the mux socket unrewritten: it reaches dsh's origin
 * fence still carrying the host page's own origin — `file://` for a packaged
 * LarePass build — and is refused with 403, while every plain `/api` call on
 * the same entrance succeeds.
 */
const SERVER_EVENTS = ["request", "upgrade"];

const TOKEN_QUERY = "token";

/** @param {{ headers?: import('node:http').IncomingHttpHeaders | Headers }} request */
export function isOlaresEdgeAuthenticated(request) {
  return viaOlaresEntrance(request?.headers ?? {});
}

/**
 * dsh 0.1.5 BrowserAuth requires a process-launch cookie on every index and
 * /api call. The entrance already decided who may reach it; treat the edge's
 * identity as the browser session instead of asking the user to open the
 * printed `?token=` URL (which is loopback and never reaches them).
 *
 * @param {{ requestRejection: Function, authorizeIndex: Function }} connection
 */
export function acceptOlaresBrowserSession(connection) {
  const reject = connection.requestRejection.bind(connection);
  connection.requestRejection = (request) => {
    const code = reject(request);
    if (code === 401 && isOlaresEdgeAuthenticated(request)) return undefined;
    return code;
  };

  const authorize = connection.authorizeIndex.bind(connection);
  connection.authorizeIndex = (req, res) => {
    const url = new URL(req.url ?? "/", "http://dsh.invalid");
    if (url.searchParams.has(TOKEN_QUERY)) return authorize(req, res);
    if (isOlaresEdgeAuthenticated(req)) return true;
    return authorize(req, res);
  };
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  if (ctx.connection) acceptOlaresBrowserSession(ctx.connection);

  /** @type {import('node:http').Server | undefined} */
  let attached;

  /** @param {import('node:http').IncomingMessage} req */
  const onRequest = (req) => {
    try {
      const identity = identityFromHeaders(req.headers ?? {});
      if (!identity.user) return;
      rememberRequestIdentity(identity);
      // dsh asks its Host fence from more than the /api gateway — open-in-app
      // asks too — so the whole entrance answers as loopback, not just /api.
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
