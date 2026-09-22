import { userDomainOf } from "./entrance.js";

export function trustedEntranceHosts(env = process.env) {
  return (env.DSH_TRUSTED_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Hostname of a bare `host[:port]` authority, or null when unparsable. */
export function hostnameOf(authority) {
  try {
    return new URL(`http://${authority}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The rendered entrance hosts pin the user's domain, not the app's third-level
 * label: Olares re-labels the entrance whenever a custom route ID or a new
 * default is assigned, and that never re-renders the chart, so the env keeps
 * the label the install happened to get. Any label under the same user domain
 * is the same entrance and the same Authelia identity.
 */
export function viaOlaresEntrance(hostHeader, entranceHosts) {
  if (!hostHeader) return false;
  const hostname = hostnameOf(hostHeader);
  if (!hostname) return false;
  const domain = userDomainOf(hostname);
  return entranceHosts.some((entry) => {
    const trusted = hostnameOf(entry);
    if (!trusted) return false;
    if (trusted === hostname) return true;
    return Boolean(domain) && userDomainOf(trusted) === domain;
  });
}

export function shouldRewriteApiLoopback(req, entranceHosts) {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  if (!path.startsWith("/api")) return false;
  return viaOlaresEntrance(req.headers.host, entranceHosts);
}

export function loopbackAuthority(port) {
  return `127.0.0.1:${port}`;
}

export function applyLoopbackHeaders(headers, authority) {
  headers.host = authority;
  if (headers.origin !== undefined) headers.origin = `http://${authority}`;
  // Fetch Metadata outlives the origin rewrite. The browser decides this one and
  // we cannot argue with it: a packaged page calling the entrance is `cross-site`
  // however the host and origin now read, and dsh refuses that outright — the
  // rewrite lands, the request is still 403. Restate it to match the loopback
  // pair the two lines above just produced.
  //
  // Only secure contexts get `Sec-` headers at all, which is why the LAN
  // entrance (plain http) never ran into this and the https one always did.
  if (headers["sec-fetch-site"] !== undefined) headers["sec-fetch-site"] = "same-origin";
}
