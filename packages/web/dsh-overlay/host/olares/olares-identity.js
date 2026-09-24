/**
 * Edge identity → olares-cli profile + treat every served request as loopback.
 * dsh locks config/LLM discover to loopback; in a pod the Olares entrance is
 * that auth layer, at whatever level the user set it to.
 */
import { identityFromHeaders } from "@olares/lares-core/olares/identity";
import { rememberRequestIdentity } from "@olares/lares-core/olares/session-identity";
import {
  applyLoopbackHeaders,
  loopbackAuthority,
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

/**
 * dsh 0.1.5 BrowserAuth requires a process-launch cookie on every index and
 * /api call, because on a laptop the loopback port is the only fence there is.
 * Here it is not: this server listens inside the pod, so the Olares entrance —
 * at whatever level the user set it to — has already decided who may reach it.
 * Accept the session instead of asking the user to open the printed `?token=`
 * URL, which is loopback and never reaches them.
 *
 * No header can stand in for that judgement. A `public` entrance bypasses
 * Authelia entirely and so arrives with no identity stamp at all, which is
 * exactly the level a third-party custom domain is forced to.
 *
 * @param {{ requestRejection: Function, authorizeIndex: Function }} connection
 */
export function acceptOlaresBrowserSession(connection) {
  const reject = connection.requestRejection.bind(connection);
  connection.requestRejection = (request) => {
    const code = reject(request);
    return code === 401 ? undefined : code;
  };

  const authorize = connection.authorizeIndex.bind(connection);
  connection.authorizeIndex = (req, res) => {
    const url = new URL(req.url ?? "/", "http://dsh.invalid");
    // The printed URL still mints its cookie; dsh redirects it off the query.
    if (url.searchParams.has(TOKEN_QUERY)) return authorize(req, res);
    return true;
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
      // Only Authelia stamps this, so a `public` entrance carries no identity;
      // it gates nothing here and only names the olares-cli session when present.
      if (identity.user) rememberRequestIdentity(identity);
      // dsh asks its Host fence from more than the /api gateway — open-in-app
      // asks too — so every route answers as loopback, not just /api.
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
