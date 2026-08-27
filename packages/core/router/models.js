import { routerCatalogRows } from "./catalog.js";
import { routerAuthHeaders, routerGatewayUrl, routerShimBaseUrl } from "./gateway.js";

export const ROUTER_PROVIDER_ID = "olares-router";
export const LLM_SETTINGS_NS = "llm-pi-ai";

const NON_CHAT_HINTS = /embed|whisper|tts|speech|ocr|clip|stt|asr|transcri/i;
const PLACEHOLDER_MODEL = /^(?:default|deepseek-v4-(?:flash|pro))$/i;

export function isChatModelId(id) {
  return !NON_CHAT_HINTS.test(id);
}

export function isChatModel(model) {
  return model.mode ? model.mode === "chat" : isChatModelId(model.id);
}

export function modelsFromRouterCatalog(payload) {
  return routerCatalogRows(payload);
}

function isMtpModelId(id) {
  return /\bmtp\b/i.test(id);
}

export function pickChatModelId(catalog) {
  const chat = catalog.filter(isChatModel);
  return chat.find((model) => isMtpModelId(model.id))?.id ?? chat[0]?.id ?? null;
}

export function isPlaceholderModelId(id) {
  if (!id) return true;
  const trimmed = id.trim();
  return !trimmed || PLACEHOLDER_MODEL.test(trimmed);
}

export function chatModelsFromRouterCatalog(payload) {
  return routerCatalogRows(payload)
    .filter(isChatModel)
    .map(({ id, name, supportsVision, reasoningEfforts, contextWindow, maxTokens }) => ({
      id,
      name,
      ...(supportsVision ? { input: ["text", "image"] } : {}),
      ...(reasoningEfforts === null ? {} : { reasoningEfforts }),
      ...(contextWindow === null ? {} : { contextWindow }),
      ...(maxTokens === null ? {} : { maxTokens }),
    }));
}

export function pickDefaultModel(models) {
  return models.find((model) => isMtpModelId(model.id)) ?? models[0] ?? null;
}

export function catalogFailure(code, status, message) {
  return Object.assign(new Error(message), { code, status });
}

export async function fetchChatModels() {
  const response = await fetch(`${routerShimBaseUrl()}/models`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw catalogFailure("router_unavailable", 503, `Router /models returned ${response.status}`);
  }
  return chatModelsFromRouterCatalog(await response.json());
}

/**
 * GET ${LLM_GATEWAY_URL}/models with in-cluster app identity.
 * @param {{ routerUrl?: string | null, routerApiKey?: string | null, olaresAppId?: string | null }} env
 */
export async function fetchRouterModels(env) {
  const routerUrl = String(env.routerUrl ?? "").replace(/\/+$/, "") || routerGatewayUrl();
  const res = await fetch(`${routerUrl}/models`, {
    method: "GET",
    headers: {
      ...routerAuthHeaders(env.routerApiKey, env.olaresAppId),
      accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Router /models returned ${res.status}`);
  return modelsFromRouterCatalog(await res.json());
}

export function parseDefaultModelRequest(request) {
  const model = typeof request?.model === "string" ? request.model.trim() : "";
  if (!model) throw catalogFailure("bad_request", 400, "model is required");
  const asked = typeof request?.provider === "string" ? request.provider.trim() : "";
  if (asked && asked !== ROUTER_PROVIDER_ID) {
    throw catalogFailure("bad_request", 400, "provider must be olares-router");
  }
  if (isPlaceholderModelId(model)) {
    throw catalogFailure("model_unavailable", 400, "Router has no configured chat model");
  }
  return { provider: ROUTER_PROVIDER_ID, model };
}

export function defaultNeedsRepair(current, models) {
  return models.length > 0
    && (current.provider !== ROUTER_PROVIDER_ID || !models.some((model) => model.id === current.model));
}

export function listedCatalogModel(provider, model) {
  if (isPlaceholderModelId(model.id)) return null;
  return {
    provider: ROUTER_PROVIDER_ID,
    providerName: provider.name,
    id: model.id,
    name: model.name || model.id,
    ...(model.description ? { description: model.description } : {}),
    ...(model.reasoningEfforts ? { reasoningEfforts: model.reasoningEfforts } : {}),
    ...(model.reasoning ? { reasoning: model.reasoning } : {}),
  };
}

export function catalogSettingsOps(models) {
  return [{ op: "set", path: ["providers", ROUTER_PROVIDER_ID, "models"], value: models }];
}

export function unregisteredRouterFailure() {
  return [{ provider: ROUTER_PROVIDER_ID, name: "Olares Router", message: "provider is not registered" }];
}

export function listedCatalog(provider, models) {
  const listed = [];
  for (const model of models) {
    const entry = listedCatalogModel(provider, model);
    if (entry) listed.push(entry);
  }
  return listed;
}
