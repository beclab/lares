import { routerGatewayUrl, routerHeaders } from "./gateway.js";

/**
 * The model Router's `default-chat` route answers with right now, as the qualified id /models lists.
 *
 * /models leaves named routes out on purpose, so the console's route list is the only place that
 * says which model a default currently targets; in-cluster callers reach it without a login. Any
 * failure is null, and callers keep their own choice.
 * @returns {Promise<string | null>}
 */
export async function defaultChatTarget({ env = process.env, fetch: request = globalThis.fetch } = {}) {
  try {
    const base = routerGatewayUrl(env).replace(/\/v1$/, "");
    const res = await request(`${base}/console/api/model-routes?kind=default`, { headers: routerHeaders(env), signal: AbortSignal.timeout(2_000) });
    if (!res.ok) return null;
    const route = (await res.json())?.items?.find((item) => item?.name === "default-chat" && item.enabled !== false);
    const members = Array.isArray(route?.members) ? route.members : [];
    const target = members.find((member) => member.provider_model_id === route?.target?.provider_model_id)
      ?? members.filter((member) => member.servable !== false).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
    return target && target.servable !== false && typeof target.qualified_name === "string" && target.qualified_name ? target.qualified_name : null;
  } catch {
    return null;
  }
}
