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

export function viaOlaresEntrance(hostHeader, entranceHosts) {
  if (!hostHeader) return false;
  const hostname = hostnameOf(hostHeader);
  if (!hostname) return false;
  return entranceHosts.some((entry) => hostnameOf(entry) === hostname);
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
