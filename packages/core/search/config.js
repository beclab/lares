import { readJsonFile, writeJsonFile } from "../tools/json-file.js";
import { HttpError } from "../tools/http.js";
import { dshPluginConfigPath } from "../workspace/home.js";
import { fetchRouterSearchModels } from "../router/search.js";

/**
 * Three states, because "nobody chose yet" and "the user turned search off"
 * must not collapse into one value: an unset default follows Router, and an
 * automatic default must never reopen search the user closed.
 * @typedef {{ defaultSearchModel: string | null, searchOff: boolean }} WebSearchConfig
 */

/** @returns {WebSearchConfig} */
function defaults() {
  return { defaultSearchModel: null, searchOff: false };
}

function configPath() {
  return dshPluginConfigPath("web-search");
}

/** @param {unknown} value */
function modelId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id.length > 512 || /[\u0000-\u001f\u007f]/.test(id)) return null;
  return id;
}

/** @param {unknown} raw @returns {WebSearchConfig} */
function normalize(raw) {
  if (!raw || typeof raw !== "object") return defaults();
  const body = /** @type {Record<string, unknown>} */ (raw);
  return {
    defaultSearchModel: modelId(body.defaultSearchModel),
    searchOff: body.searchOff === true,
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
 * @param {WebSearchConfig} selection
 * @param {{ id: string }[]} available
 */
export function setSearchSelection(selection, available) {
  if (selection.searchOff) return persist({ defaultSearchModel: null, searchOff: true });
  if (selection.defaultSearchModel === null) return persist(defaults());
  const model = modelId(selection.defaultSearchModel);
  if (!model || !available.some((item) => item.id === model)) {
    throw new HttpError("not_available", 400, "search service is not available from Router");
  }
  return persist({ defaultSearchModel: model, searchOff: false });
}

export async function currentSearchConfig() {
  const searchModels = await fetchRouterSearchModels();
  return { ...readConfig(), searchModels };
}

export const LARES_PROVIDER_ID = "lares";
export {
  SEARCH_OFF,
  SEARCH_ROUTER_DEFAULT,
  searchDefaultReady,
  searchMenuValue,
  searchStatus,
  searchValueFromMenu,
} from "./menu.js";

/** The model to send, or null to follow Router's own default-search category. */
export function configuredSearchModel() {
  return readConfig().defaultSearchModel;
}

export function searchDisabled() {
  return readConfig().searchOff;
}

/** @param {unknown} body @returns {WebSearchConfig} */
export function searchSelectionFromBody(body) {
  const raw = body && typeof body === "object" ? /** @type {Record<string, unknown>} */ (body) : null;
  if (!raw) throw new HttpError("bad_model", 400, "invalid search selection");
  const asked = raw.defaultSearchModel;
  if (asked !== null && asked !== undefined && typeof asked !== "string") {
    throw new HttpError("bad_model", 400, "invalid defaultSearchModel");
  }
  if (raw.searchOff !== undefined && typeof raw.searchOff !== "boolean") {
    throw new HttpError("bad_model", 400, "invalid searchOff");
  }
  return { defaultSearchModel: typeof asked === "string" ? asked : null, searchOff: raw.searchOff === true };
}

/** @param {WebSearchConfig} selection */
export async function setSearchSelectionFromRequest(selection) {
  const searchModels = await fetchRouterSearchModels();
  return { ...setSearchSelection(selection, searchModels), searchModels };
}
