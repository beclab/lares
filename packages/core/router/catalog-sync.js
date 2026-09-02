import { createInFlightCoalescer } from "../tools/async.js";
import { catalogCache } from "./catalog-cache.js";
import {
  LLM_SETTINGS_NS,
  ROUTER_PROVIDER_ID,
  catalogSettingsOps,
  chatModelsFromRouterCatalog,
  defaultNeedsRepair,
  listedCatalog,
  parseDefaultModelRequest,
  pickDefaultModel,
  unregisteredRouterFailure,
} from "./models.js";

function messageOf(err) {
  return err instanceof Error ? err.message : String(err);
}

let adapterRevision = 0;
/** @type {Set<(revision: number) => void>} */
const revisionListeners = new Set();

export function catalogRevision() {
  return adapterRevision;
}

/** @param {(revision: number) => void} listener */
export function onCatalogRevision(listener) {
  revisionListeners.add(listener);
  return () => revisionListeners.delete(listener);
}

function bumpRevision() {
  adapterRevision += 1;
  for (const listener of revisionListeners) listener(adapterRevision);
}

/**
 * @param {{
 *   mutateSettings: (ns: string, ops: unknown[]) => Promise<void>,
 *   currentSelection: () => { provider: string, model: string },
 *   saveSelection: (next: { provider: string, model: string }) => Promise<void>,
 * }} ports
 */
async function performRefresh(ports) {
  catalogCache.invalidate();
  const { payload } = await catalogCache.get();
  const models = chatModelsFromRouterCatalog(payload);
  await ports.mutateSettings(LLM_SETTINGS_NS, catalogSettingsOps(models));
  const current = ports.currentSelection();
  if (defaultNeedsRepair(current, models)) {
    await ports.saveSelection({ provider: ROUTER_PROVIDER_ID, model: pickDefaultModel(models).id });
  }
  bumpRevision();
  return models;
}

const coalesceRefresh = createInFlightCoalescer();

export function refreshCatalog(ports) {
  return coalesceRefresh(() => performRefresh(ports));
}

/**
 * @param {{
 *   listProviders: () => { id: string, name: string }[],
 *   listModels: (provider: string) => Promise<{ id: string, name: string, description?: string }[]>,
 * }} ports
 */
export async function listCatalog(ports) {
  const provider = ports.listProviders().find((entry) => entry.id === ROUTER_PROVIDER_ID);
  if (!provider) {
    return { models: [], failures: unregisteredRouterFailure() };
  }
  try {
    return { models: listedCatalog(provider, await ports.listModels(ROUTER_PROVIDER_ID)), failures: [] };
  } catch (err) {
    return {
      models: [],
      failures: [{ provider: ROUTER_PROVIDER_ID, name: provider.name, message: messageOf(err) }],
    };
  }
}

export function currentDefault(ports) {
  const { provider, model } = ports.currentSelection();
  return { provider, model };
}

/**
 * @param {{
 *   resolveCallConfig: (asked: { provider: string, model: string }) => Promise<{ provider: string, model: string }>,
 *   saveSelection: (next: { provider: string, model: string }) => Promise<void>,
 * }} ports
 */
export async function saveDefault(ports, request) {
  const asked = parseDefaultModelRequest(request);
  let resolved;
  try {
    resolved = await ports.resolveCallConfig(asked);
  } catch (err) {
    throw Object.assign(new Error(messageOf(err)), { code: "model_unavailable", status: 400 });
  }
  await ports.saveSelection({ provider: resolved.provider, model: resolved.model });
  return { provider: resolved.provider, model: resolved.model };
}

export function catalogState(ports, listed) {
  return {
    default: currentDefault(ports),
    models: listed.models,
    failures: listed.failures,
    revision: catalogRevision(),
  };
}
