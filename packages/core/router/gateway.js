export function routerGatewayUrl(env = process.env) {
  return (env.LLM_GATEWAY_URL ?? "http://router-svc.router-shared/v1").replace(/\/+$/, "");
}

export function routerShimBaseUrl(env = process.env) {
  const configured = env.LARES_LLM_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `http://127.0.0.1:${env.PORT ?? 8080}/llm/v1`;
}

export function routerAuthHeaders(apiKey, olaresAppId) {
  if (apiKey?.trim()) return { authorization: `Bearer ${apiKey.trim()}` };
  return { "x-caller-appid": olaresAppId?.trim() || "lares" };
}

export function routerHeaders(env = process.env) {
  return {
    ...routerAuthHeaders(env.LARES_ROUTER_API_KEY, env.OLARES_APP_ID),
    accept: "application/json",
  };
}
