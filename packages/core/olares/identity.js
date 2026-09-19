/**
 * Olares edge identity: who the reverse proxy says this request is, and the
 * browser credential it carried.
 *
 * The olares-cli session inside the container is NOT derived from this. It
 * comes from the credential app-service mounts for `permission.loginOlaresCLI`
 * (/olares/credentials), which is the only source that knows the user's full
 * Olares ID and can refresh itself.
 */

/**
 * @typedef {{ user: string, token: string }} OlaresIdentity
 */

/** @param {string} cookieHeader */
function parseCookies(cookieHeader) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of cookieHeader.split(";")) {
    if (!part.includes("=")) continue;
    const [name, ...rest] = part.split("=");
    out[name.trim()] = rest.join("=").trim();
  }
  return out;
}

/** Username without domain; Olares may send `user` or `user@olares.com`. */
export function olaresUsername(user) {
  return String(user || "").split("@", 1)[0]?.trim().toLowerCase() ?? "";
}

/**
 * @param {import('node:http').IncomingHttpHeaders | Headers | Record<string, string | string[] | undefined>} headers
 * @returns {OlaresIdentity}
 */
export function identityFromHeaders(headers) {
  const get = (name) => {
    if (typeof Headers !== "undefined" && headers instanceof Headers) {
      return headers.get(name) ?? "";
    }
    const raw = /** @type {Record<string, string | string[] | undefined>} */ (headers)[name]
      ?? /** @type {Record<string, string | string[] | undefined>} */ (headers)[name.toLowerCase()];
    if (Array.isArray(raw)) return raw.join(",");
    return raw ?? "";
  };

  const user = (
    get("remote-user")
    || get("authelia-remote-user")
    || get("x-bfl-user")
    || ""
  ).trim();

  const cookies = parseCookies(get("cookie"));
  let token = (cookies.auth_token ?? "").trim();
  if (!token) {
    const authorization = get("authorization").trim();
    if (authorization.toLowerCase().startsWith("bearer ")) {
      token = authorization.slice(7).trim();
    } else if (authorization) {
      token = authorization;
    }
  }
  if (!token) token = get("x-authorization").trim();

  return { user, token };
}
