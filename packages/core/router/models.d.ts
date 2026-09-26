import type { RouterCatalogRow } from "./catalog.js";

export type RouterModelEntry = RouterCatalogRow;
export const ROUTER_RETRY_POLICY: Readonly<{
  mode: "normal";
  maxRetries: number;
  retryableCodes: string[];
  backoff: { initialDelayMs: number; maxDelayMs: number; jitterRatio: number };
}>;
export function isChatModelId(id: string): boolean;
export function isChatModel(model: RouterModelEntry): boolean;
export function modelsFromRouterCatalog(payload: unknown): RouterModelEntry[];
export function pickChatModelId(catalog: RouterModelEntry[]): string | null;
export function isPlaceholderModelId(id: string | null | undefined): boolean;
export function chatModelsFromRouterCatalog(payload: unknown): Array<Record<string, unknown> & { id: string; name: string }>;
export function pickDefaultModel<T extends { id: string }>(models: T[]): T | null;
export function fetchChatModels(): Promise<Array<Record<string, unknown> & { id: string; name: string }>>;
export function fetchRouterModels(env: {
  routerUrl?: string | null;
  routerApiKey?: string | null;
  olaresAppId?: string | null;
  dataDir?: string | null;
}): Promise<RouterModelEntry[]>;
