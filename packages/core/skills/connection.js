import { HttpError } from "../tools/http.js";

/** Profile hass-cli uses when Lares talks to Home Assistant. */
export const HASS_PROFILE = "lares";

/**
 * @param {unknown} body
 * @returns {{ server: string, token: string }}
 */
export function connectionInput(body) {
  const record = body && typeof body === "object" ? body : {};
  const server = typeof record.server === "string" ? record.server.trim() : "";
  const token = typeof record.token === "string" ? record.token.trim() : "";
  if (!server || !token) throw new HttpError("bad_request", 400, "server and token are required");
  let url;
  try {
    url = new URL(server);
  } catch {
    throw new HttpError("bad_request", 400, "server must be an http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError("bad_request", 400, "server must be an http(s) URL");
  }
  if (url.username || url.password) {
    throw new HttpError("bad_request", 400, "server must not include credentials");
  }
  if (token.length < 20 || token.length > 8192) {
    throw new HttpError("bad_request", 400, "token is not a long-lived access token");
  }
  url.hash = "";
  const normalized = url.pathname === "/" && !url.search ? url.origin : url.toString().replace(/\/$/, "");
  return { server: normalized, token };
}

/** Read server presence out of `hass-cli profile show -o json`. Never returns the token. */
export function connectionStatus(raw) {
  const text = String(raw ?? "").trim();
  if (!text || /no profiles/i.test(text)) return { configured: false, server: "" };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { configured: false, server: "" };
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const row = rows.find((item) => item?.current) ?? rows.find((item) => item?.name === HASS_PROFILE) ?? rows[0];
  const server = typeof row?.server === "string" ? row.server.trim() : "";
  return { configured: Boolean(server), server };
}

export function profileLoginArgs(server) {
  return ["profile", "login", HASS_PROFILE, "--server", server, "--token-stdin", "--force"];
}

export function scrubSecret(text, secret) {
  const raw = String(text ?? "");
  if (!secret) return raw;
  return raw.split(secret).join("***");
}
