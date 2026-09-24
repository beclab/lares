import { identityFromHeaders } from "./identity.js";

/**
 * An entrance request is one the Olares edge routed here, and only the edge can
 * say so: it stamps the entrance's user on everything it forwards. The Host
 * cannot decide it. The chart can only render the label the install was given, a
 * custom route ID re-labels the entrance without re-rendering the chart, and a
 * third-party custom domain is not under the user domain at all — that one is
 * also necessarily `public`, so it arrives stamped but without an Authelia
 * cookie, which is why the token is no part of this judgement.
 *
 * Nothing but the edge reaches this process over an entrance: in-cluster callers
 * address the service and carry no stamp of their own.
 */
export function viaOlaresEntrance(headers) {
  return Boolean(identityFromHeaders(headers ?? {}).user);
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
