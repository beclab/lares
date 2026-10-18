import { catalogCoordinator } from "./catalog-coordinator.js";
import { authorizedChatModel } from "./model-authorization.js";
import {
  ROUTER_PROVIDER_ID,
  listedCatalog,
  parseDefaultModelRequest,
  unregisteredRouterFailure,
} from "./models.js";
import { forgetSttModel } from "./stt.js";

function messageOf(err) {
  return err instanceof Error ? err.message : String(err);
}

export function catalogRevision() { return catalogCoordinator.revision; }
export function onCatalogRevision(listener) {
  catalogCoordinator.listeners.add(listener);
  return () => catalogCoordinator.listeners.delete(listener);
}
export async function refreshCatalog(ports) {
  const snapshot = await catalogCoordinator.sync(ports, true);
  forgetSttModel();
  return snapshot.models;
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
    const authorized = await catalogCoordinator.sync(ports);
    return {
      models: listedCatalog(provider, await ports.listModels(ROUTER_PROVIDER_ID)).filter((model) => authorized.rows.some((row) => row.id === model.id)),
      failures: [],
    };
  } catch (err) {
    return {
      models: listedCatalog(provider, catalogCoordinator.committed?.models ?? []),
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
    await catalogCoordinator.sync(ports);
    if (!await authorizedChatModel(asked)) throw new Error("Select an authorized chat model");
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
