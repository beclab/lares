import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { routerCatalogRows } from "./router-catalog.js";

export const DEFAULT_TTL_MS = 15_000;

function routerUrl() {
  return (process.env.LLM_GATEWAY_URL ?? "http://router-svc.router-shared/v1").replace(/\/+$/, "");
}

function routerHeaders() {
  const apiKey = process.env.LARES_ROUTER_API_KEY?.trim();
  return {
    ...(apiKey
      ? { authorization: `Bearer ${apiKey}` }
      : { "x-caller-appid": process.env.OLARES_APP_ID?.trim() || "lares" }),
    accept: "application/json",
  };
}

export function catalogSeedPath(dataDir = process.env.LARES_DATA_DIR?.trim()) {
  return dataDir ? join(dataDir, "router-catalog.json") : null;
}

export function writeCatalogSeed(payload, dataDir) {
  const path = catalogSeedPath(dataDir);
  if (!path || payload == null || typeof payload !== "object") return;
  writeFileSync(path, JSON.stringify(payload), { mode: 0o600 });
}

function readCatalogSeed(dataDir) {
  const path = catalogSeedPath(dataDir);
  if (!path) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // Missing or unreadable seed is a cold start, not a failure.
  }
  return null;
}

/**
 * In-process Router /models cache. TTL plus coalesced upstream fetches; a
 * seed file lets the dsh child reuse the boot process's catalog read.
 */
export class CatalogCache {
  /**
   * @param {{
   *   ttlMs?: number,
   *   fetch?: typeof fetch,
   *   now?: () => number,
   *   dataDir?: string,
   * }} [options]
   */
  constructor(options = {}) {
    this.ttlMs = options.ttlMs && options.ttlMs > 0 ? options.ttlMs : DEFAULT_TTL_MS;
    this.fetchImpl = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.now = options.now ?? Date.now;
    this.dataDir = options.dataDir;
    this.reset();
  }

  reset() {
    this.payload = null;
    this.rows = [];
    this.fetchedAt = 0;
    this.inflight = null;
    this.primed = false;
  }

  invalidate() {
    this.fetchedAt = 0;
  }

  /**
   * @param {unknown} payload
   */
  seed(payload) {
    this.primed = true;
    this.accept(payload);
    writeCatalogSeed(payload, this.dataDir);
  }

  snapshot() {
    return { payload: this.payload, rows: this.rows };
  }

  async get() {
    if (this.payload && this.fetchedAt !== 0 && this.now() - this.fetchedAt < this.ttlMs) {
      return this.snapshot();
    }
    if (this.inflight) return this.inflight;
    const pending = this.load();
    const shared = pending.finally(() => {
      if (this.inflight === shared) this.inflight = null;
    });
    this.inflight = shared;
    return shared;
  }

  async load() {
    if (!this.primed) {
      this.primed = true;
      const seeded = readCatalogSeed(this.dataDir);
      if (seeded) {
        this.accept(seeded);
        return this.snapshot();
      }
    }
    const response = await this.fetchImpl(`${routerUrl()}/models?include_not_ready=true`, {
      method: "GET",
      headers: routerHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw Object.assign(new Error(`Router /models returned ${response.status}`), {
        code: "router_unavailable",
        status: 503,
      });
    }
    const payload = await response.json();
    this.accept(payload);
    writeCatalogSeed(payload, this.dataDir);
    return this.snapshot();
  }

  /**
   * @param {unknown} payload
   */
  accept(payload) {
    this.payload = payload;
    this.rows = routerCatalogRows(payload);
    this.fetchedAt = this.now();
  }
}

export const catalogCache = new CatalogCache();
