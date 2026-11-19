import { readJsonFile, writeJsonFile } from "../tools/json-file.js";
import { HttpError } from "../tools/http.js";
import { dshPluginConfigPath } from "../workspace/home.js";
import { fetchRouterFetchModels } from "../router/fetch.js";

/**
 * Three states, because "nobody chose yet" and "the user turned fetch off"
 * must not collapse into one value: an unset default follows Router, and an
 * automatic default must never reopen fetch the user closed.
 * @typedef {{ defaultFetchModel: string | null, fetchOff: boolean }} WebFetchConfig
 */

/** @returns {WebFetchConfig} */
function defaults() {
  return { defaultFetchModel: null, fetchOff: false };
}

function configPath() {
  return dshPluginConfigPath("web-fetch");
}

/** @param {unknown} value */
function modelId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id.length > 512 || /[\u0000-\u001f\u007f]/.test(id)) return null;
  return id;
}

/** @param {unknown} raw @returns {WebFetchConfig} */
function normalize(raw) {
  if (!raw || typeof raw !== "object") return defaults();
  const body = /** @type {Record<string, unknown>} */ (raw);
  return {
    defaultFetchModel: modelId(body.defaultFetchModel),
    fetchOff: body.fetchOff === true,
  };
}

/** @returns {WebFetchConfig} */
export function readConfig() {
  return normalize(readJsonFile(configPath()));
}

/**
 * @param {WebFetchConfig} config
 * @returns {WebFetchConfig}
 */
function persist(config) {
  const path = configPath();
  const normalized = normalize(config);
  writeJsonFile(path, normalized);
  return normalized;
}

/**
 * @param {WebFetchConfig} selection
 * @param {{ id: string }[]} available
 */
export function setFetchSelection(selection, available) {
  if (selection.fetchOff) return persist({ defaultFetchModel: null, fetchOff: true });
  if (selection.defaultFetchModel === null) return persist(defaults());
  const model = modelId(selection.defaultFetchModel);
  if (!model || !available.some((item) => item.id === model)) {
    throw new HttpError("not_available", 400, "fetch service is not available from Router");
  }
  return persist({ defaultFetchModel: model, fetchOff: false });
}

/** @param {{ refresh?: boolean }} [options] */
export async function currentFetchConfig(options = {}) {
  const fetchModels = await fetchRouterFetchModels(options);
  return { ...readConfig(), fetchModels };
}

export const LARES_PROVIDER_ID = "lares";
export {
  FETCH_OFF,
  FETCH_ROUTER_DEFAULT,
  fetchDefaultReady,
  fetchMenuValue,
  fetchStatus,
  fetchValueFromMenu,
} from "./menu.js";

/** The model to send, or null to follow Router's own default-scrape category. */
export function configuredFetchModel() {
  return readConfig().defaultFetchModel;
}

export function fetchDisabled() {
  return readConfig().fetchOff;
}

/** @param {unknown} body @returns {WebFetchConfig} */
export function fetchSelectionFromBody(body) {
  const raw = body && typeof body === "object" ? /** @type {Record<string, unknown>} */ (body) : null;
  if (!raw) throw new HttpError("bad_model", 400, "invalid fetch selection");
  const asked = raw.defaultFetchModel;
  if (asked !== null && asked !== undefined && typeof asked !== "string") {
    throw new HttpError("bad_model", 400, "invalid defaultFetchModel");
  }
  if (raw.fetchOff !== undefined && typeof raw.fetchOff !== "boolean") {
    throw new HttpError("bad_model", 400, "invalid fetchOff");
  }
  return { defaultFetchModel: typeof asked === "string" ? asked : null, fetchOff: raw.fetchOff === true };
}

/** @param {WebFetchConfig} selection */
export async function setFetchSelectionFromRequest(selection) {
  const fetchModels = await fetchRouterFetchModels();
  return { ...setFetchSelection(selection, fetchModels), fetchModels };
}
