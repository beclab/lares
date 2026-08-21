import type { LaresEnv } from "../config/env.js";
import {
  routerCatalogRows,
  type RouterCatalogRow,
} from "../../../packages/plugins/shared/host/router-catalog.js";

export type RouterModelEntry = RouterCatalogRow;

const NON_CHAT_HINTS = /embed|whisper|tts|speech|ocr|clip|stt|asr|transcri/i;

/** Skip embedding / audio / OCR models when picking a chat default. */
export function isChatModelId(id: string): boolean {
  return !NON_CHAT_HINTS.test(id);
}

export function isChatModel(model: RouterModelEntry): boolean {
  return model.mode ? model.mode === "chat" : isChatModelId(model.id);
}

export function modelsFromRouterCatalog(payload: unknown): RouterModelEntry[] {
  return routerCatalogRows(payload);
}

/**
 * Multi-token-prediction build: same weights as its plain sibling, faster
 * decode, so it is the better default whenever the Router offers both.
 */
function isMtpModelId(id: string): boolean {
  return /\bmtp\b/i.test(id);
}

export function pickChatModelId(catalog: RouterModelEntry[]): string | null {
  const chat = catalog.filter(isChatModel);
  return chat.find((m) => isMtpModelId(m.id))?.id ?? chat[0]?.id ?? null;
}

function routerAuthHeaders(apiKey: string | null, olaresAppId: string): Record<string, string> {
  if (apiKey) return { authorization: `Bearer ${apiKey}` };
  return { "x-caller-appid": olaresAppId };
}

/** GET ${LLM_GATEWAY_URL}/models with in-cluster app identity. */
export async function fetchRouterModels(env: Pick<LaresEnv, "routerUrl" | "routerApiKey" | "olaresAppId">): Promise<RouterModelEntry[]> {
  const headers = {
    ...routerAuthHeaders(env.routerApiKey, env.olaresAppId),
    accept: "application/json",
  };
  const res = await fetch(`${env.routerUrl}/models`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Router /models returned ${res.status}`);
  }
  return modelsFromRouterCatalog(await res.json());
}

/** Model ids that are placeholders / dsh factory defaults — not Router catalog. */
export function isPlaceholderModelId(id: string | null | undefined): boolean {
  if (!id) return true;
  const trimmed = id.trim();
  if (!trimmed || trimmed === "default") return true;
  return /^deepseek-v4-(flash|pro)$/i.test(trimmed);
}
