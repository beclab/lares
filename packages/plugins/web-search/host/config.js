/**
 * Web-search settings under $DSH_HOME/web-search/config.json.
 * Secrets stay in this file (mode 0600); public API never echoes apiKey.
 *
 * Saving a provider requires a successful probe (see host/index.js), so a
 * persisted provider is by definition tested — there is no separate "verified"
 * flag. Selecting a default is choosing among the saved providers.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const PROVIDER_IDS = /** @type {const} */ (["tavily", "custom"]);

/** @typedef {'tavily' | 'custom'} ProviderId */

/**
 * @typedef {{
 *   defaultProvider: ProviderId | null,
 *   providers: {
 *     tavily: { apiKey: string },
 *     custom: { url: string, apiKey: string },
 *   },
 * }} WebSearchConfig
 */

/** @returns {WebSearchConfig} */
function defaults() {
  return {
    defaultProvider: null,
    providers: {
      tavily: { apiKey: "" },
      custom: { url: "", apiKey: "" },
    },
  };
}

function configPath() {
  const home = process.env.DSH_HOME?.trim() || "/data/dina/dsh-home";
  return join(home, "web-search", "config.json");
}

/** @param {unknown} value @returns {value is ProviderId} */
export function isProviderId(value) {
  return value === "tavily" || value === "custom";
}

/** A saved provider is a tested one: it has the credentials it needs. */
export function providerConfigured(config, id) {
  if (id === "tavily") return Boolean(config.providers.tavily.apiKey.trim());
  const custom = config.providers.custom;
  return Boolean(custom.apiKey.trim()) && Boolean(custom.url.trim()) && URL.canParse(custom.url.trim());
}

/** Ready to run search: a saved provider is selected as default. */
export function providerReady(config, id = config.defaultProvider) {
  if (!isProviderId(id)) return false;
  return providerConfigured(config, id);
}

/** @param {unknown} raw @returns {WebSearchConfig} */
function normalize(raw) {
  const next = defaults();
  if (!raw || typeof raw !== "object") return next;
  const body = /** @type {Record<string, unknown>} */ (raw);
  if (isProviderId(body.defaultProvider)) next.defaultProvider = body.defaultProvider;

  const providers = body.providers;
  if (!providers || typeof providers !== "object") return reconcileDefault(next);
  const map = /** @type {Record<string, unknown>} */ (providers);

  const tavily = map.tavily;
  if (tavily && typeof tavily === "object") {
    const row = /** @type {Record<string, unknown>} */ (tavily);
    if (typeof row.apiKey === "string") next.providers.tavily.apiKey = row.apiKey;
  }

  const custom = map.custom;
  if (custom && typeof custom === "object") {
    const row = /** @type {Record<string, unknown>} */ (custom);
    if (typeof row.url === "string") next.providers.custom.url = row.url.trim();
    if (typeof row.apiKey === "string") next.providers.custom.apiKey = row.apiKey;
  }

  return reconcileDefault(next);
}

/** Drop default when the chosen backend is no longer saved. */
function reconcileDefault(config) {
  const id = config.defaultProvider;
  if (id && !providerReady(config, id)) config.defaultProvider = null;
  return config;
}

/** @returns {WebSearchConfig} */
export function readConfig() {
  const path = configPath();
  if (!existsSync(path)) return defaults();
  try {
    return normalize(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return defaults();
  }
}

/**
 * @param {WebSearchConfig} config
 * @returns {WebSearchConfig}
 */
function persist(config) {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(reconcileDefault(config), null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  return readConfig();
}

/**
 * Persist one provider's credentials. Call only after a successful probe;
 * a blank apiKey keeps the stored secret so users can re-save without retyping.
 * @param {ProviderId} id
 * @param {{ apiKey?: string, url?: string }} creds
 */
export function writeProvider(id, creds) {
  const current = readConfig();
  const next = {
    defaultProvider: current.defaultProvider,
    providers: {
      tavily: { ...current.providers.tavily },
      custom: { ...current.providers.custom },
    },
  };

  if (id === "tavily") {
    const apiKey =
      typeof creds.apiKey === "string" && creds.apiKey.trim()
        ? creds.apiKey.trim()
        : current.providers.tavily.apiKey;
    next.providers.tavily = { apiKey };
  } else {
    const apiKey =
      typeof creds.apiKey === "string" && creds.apiKey.trim()
        ? creds.apiKey.trim()
        : current.providers.custom.apiKey;
    const url = typeof creds.url === "string" ? creds.url.trim() : current.providers.custom.url;
    next.providers.custom = { url, apiKey };
  }

  return persist(next);
}

/**
 * Switch default provider immediately. Target must already be saved.
 * @param {ProviderId | null} id
 */
export function setDefaultProvider(id) {
  const current = readConfig();
  if (id === null) {
    return persist({ ...current, defaultProvider: null });
  }
  if (!isProviderId(id)) {
    throw Object.assign(new Error("invalid provider"), { code: "bad_provider" });
  }
  if (!providerReady(current, id)) {
    throw Object.assign(new Error("provider is not saved"), { code: "not_saved" });
  }
  return persist({ ...current, defaultProvider: id });
}

/** Redacted view for the settings UI. */
export function publicConfig(config = readConfig()) {
  return {
    defaultProvider: config.defaultProvider,
    providers: {
      tavily: {
        hasApiKey: Boolean(config.providers.tavily.apiKey.trim()),
        saved: providerConfigured(config, "tavily"),
      },
      custom: {
        url: config.providers.custom.url,
        hasApiKey: Boolean(config.providers.custom.apiKey.trim()),
        saved: providerConfigured(config, "custom"),
      },
    },
  };
}
