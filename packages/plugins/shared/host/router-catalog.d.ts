export interface RouterCatalogRow {
  id: string;
  name: string;
  mode: string | null;
  /** pi-ai level → Router wire spelling, or null when the model takes no effort. */
  reasoningEfforts: Record<string, string> | null;
  /** Tokens one request may span, or null when Router states none. */
  contextWindow: number | null;
  /** Longest reply the model can produce, or null when Router states none. */
  maxTokens: number | null;
}

export function routerCatalogRows(payload: unknown): RouterCatalogRow[];
