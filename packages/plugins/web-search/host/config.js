/** Web-search settings under $DSH_HOME/web-search/config.json. */
import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "../../shared/host/json-file.js";

/** @typedef {{ defaultSearchModel: string | null }} WebSearchConfig */

/** @returns {WebSearchConfig} */
function defaults() {
  return { defaultSearchModel: null };
}

function configPath() {
  const home = process.env.DSH_HOME?.trim() || "/data/dina/dsh-home";
  return join(home, "web-search", "config.json");
}

/** @param {unknown} raw @returns {WebSearchConfig} */
function normalize(raw) {
  if (!raw || typeof raw !== "object") return defaults();
  const body = /** @type {Record<string, unknown>} */ (raw);
  const value = typeof body.defaultSearchModel === "string" ? body.defaultSearchModel.trim() : "";
  return {
    defaultSearchModel: value && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value)
      ? value
      : null,
  };
}

/** @returns {WebSearchConfig} */
export function readConfig() {
  return normalize(readJsonFile(configPath()));
}

/**
 * @param {WebSearchConfig} config
 * @returns {WebSearchConfig}
 */
function persist(config) {
  const path = configPath();
  const normalized = normalize(config);
  writeJsonFile(path, normalized);
  return normalized;
}

/**
 * @param {string | null} id
 * @param {{ id: string }[]} available
 */
export function setDefaultSearchModel(id, available) {
  if (id === null) {
    return persist({ defaultSearchModel: null });
  }
  const model = typeof id === "string" ? id.trim() : "";
  if (
    !model
    || model.length > 512
    || /[\u0000-\u001f\u007f]/.test(model)
    || !available.some((item) => item.id === model)
  ) {
    throw Object.assign(new Error("search service is not available from Router"), {
      code: "not_available",
    });
  }
  return persist({ defaultSearchModel: model });
}
