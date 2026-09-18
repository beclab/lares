import { olaresUsername } from "../olares/identity.js";
import { getLatestIdentity } from "../olares/session-identity.js";

export function routerGatewayUrl(env = process.env) {
  return (env.LLM_GATEWAY_URL ?? "http://router-svc.router-shared/v1").replace(/\/+$/, "");
}

export function routerShimBaseUrl(env = process.env) {
  const configured = env.LARES_LLM_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `http://127.0.0.1:${env.PORT ?? 8080}/llm/v1`;
}

/**
 * End user for Router/FlowStudio: the person logged into this Lares, not the
 * shared FlowStudio chart owner. Session identity wins; chart install user is
 * the fallback for background fetches with no request.
 */
export function routerEndUser(env = process.env, incoming = {}) {
  const fromHeaders = incomingUser(incoming);
  if (fromHeaders) return fromHeaders;
  const fromSession = olaresUsername(getLatestIdentity()?.user);
  if (fromSession) return fromSession;
  return olaresUsername(env.OLARES_USERNAME || env.BFL_USERNAME || "");
}

function incomingUser(incoming) {
  if (!incoming || typeof incoming !== "object") return "";
  const get = (name) => {
    const raw = incoming[name] ?? incoming[name.toLowerCase()];
    if (Array.isArray(raw)) return raw[0] ?? "";
    return raw ?? "";
  };
  return olaresUsername(
    get("x-bfl-user") || get("remote-user") || get("authelia-remote-user") || "",
  );
}

export function routerAuthHeaders(apiKey, olaresAppId, olaresUser) {
  /** @type {Record<string, string>} */
  const headers = apiKey?.trim()
    ? { authorization: `Bearer ${apiKey.trim()}` }
    : { "x-caller-appid": olaresAppId?.trim() || "lares" };
  const user = olaresUsername(olaresUser);
  if (user) {
    headers["x-bfl-user"] = user;
    headers["remote-user"] = user;
  }
  return headers;
}

export function routerHeaders(env = process.env) {
  return {
    ...routerAuthHeaders(env.LARES_ROUTER_API_KEY, env.OLARES_APP_ID, routerEndUser(env)),
    accept: "application/json",
  };
}
