import type { DinaEnv } from "../config/env.js";

export interface RouterModelEntry {
  id: string;
  name: string;
}

/** Skip embedding / audio / OCR models when picking a chat default. */
export function isChatModelId(id: string): boolean {
  const lower = id.toLowerCase();
  return !/(embed|whisper|tts|speech|ocr|clip)/.test(lower);
}

export function modelsFromRouterCatalog(payload: unknown): RouterModelEntry[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const out: RouterModelEntry[] = [];
  const seen = new Set<string>();
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const id = String((item as { id?: unknown }).id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: id });
  }
  return out;
}

export function pickChatModelId(catalog: RouterModelEntry[]): string | null {
  return catalog.find((m) => isChatModelId(m.id))?.id ?? catalog[0]?.id ?? null;
}

function routerAuthHeaders(apiKey: string | null, olaresAppId: string): Record<string, string> {
  if (apiKey) return { authorization: `Bearer ${apiKey}` };
  return { "x-caller-appid": olaresAppId };
}

/** GET ${LLM_GATEWAY_URL}/models with in-cluster app identity. */
export async function fetchRouterModels(env: Pick<DinaEnv, "routerUrl" | "routerApiKey" | "olaresAppId">): Promise<RouterModelEntry[]> {
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
