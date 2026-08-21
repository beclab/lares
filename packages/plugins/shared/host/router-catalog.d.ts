export interface RouterCatalogRow {
  id: string;
  name: string;
  mode: string | null;
  /** pi-ai level → Router wire spelling, or null when the model takes no effort. */
  reasoningEfforts: Record<string, string> | null;
}

export function routerCatalogRows(payload: unknown): RouterCatalogRow[];
