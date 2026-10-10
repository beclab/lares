/**
 * Same-origin PC / phone split for the Lares entrance.
 *
 * FlowStudio serves both SPAs from `/` and picks the bundle per request
 * (query, then cookie, then Client Hints, then User-Agent). Lares does the
 * same: the phone page and the dsh desktop shell share the entrance host.
 * Named routes (`/api`, `/llm`) never reach this choice.
 */

const MOBILE_UA_RE = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile/i;
const IPAD_DESKTOP_UA_RE = /macintosh.*mobile\/|mobile\/.*macintosh|iphone os|cpu os \d+/i;

export const UI_COOKIE_NAME = "lares_ui";
export const UI_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const STATIC_SUFFIXES = [
  ".js", ".mjs", ".cjs", ".css", ".map", ".json", ".webmanifest",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico",
  ".woff", ".woff2", ".ttf", ".otf", ".txt", ".wasm",
];

export function isMobileUserAgent(userAgent) {
  if (!userAgent) return false;
  if (MOBILE_UA_RE.test(userAgent)) return true;
  return IPAD_DESKTOP_UA_RE.test(userAgent);
}

function forcedUi(value) {
  const surface = String(value ?? "").trim().toLowerCase();
  return surface === "mobile" || surface === "pc" ? surface : null;
}

function forcedUiFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  for (const part of String(cookieHeader).split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== UI_COOKIE_NAME) continue;
    return forcedUi(part.slice(eq + 1));
  }
  return null;
}

/**
 * @param {{ userAgent?: string, cookie?: string, clientHint?: string, query?: string | URLSearchParams }} input
 * @returns {{ surface: "mobile" | "pc", setCookie: "mobile" | "pc" | null }}
 */
export function resolveSpaSurface({ userAgent = "", cookie = "", clientHint = "", query = "" } = {}) {
  const params = query instanceof URLSearchParams
    ? query
    : new URLSearchParams(String(query ?? "").replace(/^\?/, ""));
  const fromQuery = forcedUi(params.get("ui"));
  if (fromQuery) return { surface: fromQuery, setCookie: fromQuery };

  const fromCookie = forcedUiFromCookie(cookie);
  if (fromCookie) return { surface: fromCookie, setCookie: null };

  if (String(clientHint ?? "").trim() === "?1") return { surface: "mobile", setCookie: null };

  return { surface: isMobileUserAgent(userAgent) ? "mobile" : "pc", setCookie: null };
}

export function surfaceFromRequest(req) {
  const url = new URL(req?.url ?? "/", "http://lares.invalid");
  const headers = req?.headers ?? {};
  return resolveSpaSurface({
    userAgent: headers["user-agent"] || "",
    cookie: headers.cookie || "",
    clientHint: headers["sec-ch-ua-mobile"] || "",
    query: url.searchParams,
  });
}

export function uiCookieHeader(surface) {
  return `${UI_COOKIE_NAME}=${surface}; Path=/; Max-Age=${UI_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/** History routes fall back to index.html. Hashed assets must 404 as themselves. */
export function isMobileIndexPath(pathname) {
  const path = String(pathname ?? "/").replace(/\\/g, "/").split("?")[0];
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  if (!name || name === "index.html") return true;
  return !STATIC_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

export function spaCacheControl(pathname) {
  const normalized = String(pathname ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  const name = normalized.split("/").pop()?.toLowerCase() ?? "";
  if (!name || name === "index.html" || name.endsWith(".html")) {
    return "no-cache, no-store, must-revalidate";
  }
  if (normalized.startsWith("assets/") || normalized.includes("/assets/")) {
    return "public, max-age=31536000, immutable";
  }
  return "no-cache";
}
