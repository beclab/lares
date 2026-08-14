/**
 * Olares edge integration for the dsh Host, in one request hook:
 *
 * 1. Materialize an olares-cli profile from the edge identity (test_lares cold path).
 * 2. Treat an edge-authenticated /api request as loopback.
 *
 * (2) exists because dsh pins its whole configuration plane (`settings.*`,
 * `credentials.*`, `llm.discoverModels`) to loopback "until a real
 * authentication layer exists" — trustedHosts is only a DNS-rebinding fence.
 * The Olares entrance is that layer: authLevel private, Authelia-terminated,
 * per-user pod, and the edge injects the user header the browser cannot forge.
 */
import { identityFromHeaders } from "./identity.js";
import { rememberRequestIdentity } from "./session-identity.js";

export const name = "dina-olares-identity";
export const inject = ["webServer"];

function trustedEntranceHosts() {
  return (process.env.DSH_TRUSTED_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Hostname of a bare `host[:port]` authority, or null when unparsable. */
function hostnameOf(authority) {
  try {
    return new URL(`http://${authority}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {string[]} entranceHosts
 */
function viaOlaresEntrance(req, entranceHosts) {
  const host = req.headers.host;
  if (!host) return false;
  const hostname = hostnameOf(host);
  if (!hostname) return false;
  return entranceHosts.some((entry) => hostnameOf(entry) === hostname);
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

      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (!edgeAuthenticated || !path.startsWith("/api")) return;
      if (!viaOlaresEntrance(req, trustedEntranceHosts())) return;

      const loopback = `127.0.0.1:${ctx.webServer.port}`;
      req.headers.host = loopback;
      if (req.headers.origin !== undefined) req.headers.origin = `http://${loopback}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[dina] olares identity skipped: ${message}`);
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
    ctx.effect(() => detach, "dina-olares-identity");
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
    "dina-olares-identity",
  );
}
