import { readJsonFile, writeJsonFile } from "../tools/json-file.js";
import { HttpError } from "../tools/http.js";
import { dshPluginConfigPath } from "../workspace/home.js";
import { fetchRouterSearchModels } from "../router/search.js";

/** @typedef {{ defaultSearchModel: string | null }} WebSearchConfig */

/** @returns {WebSearchConfig} */
function defaults() {
  return { defaultSearchModel: null };
}

function configPath() {
  return dshPluginConfigPath("web-search");
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
    throw new HttpError("not_available", 400, "search service is not available from Router");
  }
  return persist({ defaultSearchModel: model });
}

export async function currentSearchConfig() {
  const searchModels = await fetchRouterSearchModels();
  return {
    defaultSearchModel: readConfig().defaultSearchModel,
    searchModels,
  };
}

export const LARES_PROVIDER_ID = "lares";
export { SEARCH_NONE, searchDefaultReady, searchMenuValue, searchValueFromMenu } from "./menu.js";

export function configuredSearchModel() {
  return readConfig().defaultSearchModel;
}

export function defaultSearchModelFromBody(body) {
  const id = body?.defaultSearchModel === null ? null : body?.defaultSearchModel;
  if (id !== null && typeof id !== "string") {
    throw new HttpError("bad_model", 400, "invalid defaultSearchModel");
  }
  return id;
}

export async function setDefaultSearchFromRequest(id) {
  if (id !== null && typeof id !== "string") {
    throw new HttpError("bad_model", 400, "invalid defaultSearchModel");
  }
  const searchModels = await fetchRouterSearchModels();
  const saved = setDefaultSearchModel(id, searchModels);
  return {
    defaultSearchModel: saved.defaultSearchModel,
    searchModels,
  };
}
