import type { RouterCatalogRow } from "./router-catalog.js";

export const DEFAULT_TTL_MS: number;

export function catalogSeedPath(dataDir?: string): string | null;
export function writeCatalogSeed(payload: unknown, dataDir?: string): void;

export interface CatalogSnapshot {
  payload: unknown;
  rows: RouterCatalogRow[];
}

export class CatalogCache {
  constructor(options?: {
    ttlMs?: number;
    fetch?: typeof fetch;
    now?: () => number;
    dataDir?: string;
  });
  reset(): void;
  invalidate(): void;
  seed(payload: unknown): void;
  snapshot(): CatalogSnapshot;
  get(): Promise<CatalogSnapshot>;
}

export const catalogCache: CatalogCache;
