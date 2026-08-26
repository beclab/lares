import { createInFlightCoalescer } from "../tools/async.js";
import {
  LLM_SETTINGS_NS,
  ROUTER_PROVIDER_ID,
  catalogSettingsOps,
  defaultNeedsRepair,
  fetchChatModels,
  listedCatalog,
  parseDefaultModelRequest,
  pickDefaultModel,
  unregisteredRouterFailure,
} from "./models.js";

function messageOf(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * @param {{
 *   mutateSettings: (ns: string, ops: unknown[]) => Promise<void>,
 *   currentSelection: () => { provider: string, model: string },
 *   saveSelection: (next: { provider: string, model: string }) => Promise<void>,
 * }} ports
 */
async function performRefresh(ports) {
  const models = await fetchChatModels();
  await ports.mutateSettings(LLM_SETTINGS_NS, catalogSettingsOps(models));
  const current = ports.currentSelection();
  if (defaultNeedsRepair(current, models)) {
    await ports.saveSelection({ provider: ROUTER_PROVIDER_ID, model: pickDefaultModel(models).id });
  }
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
  return { default: currentDefault(ports), models: listed.models, failures: listed.failures };
}
