import { catalogCache } from "./catalog-cache.js";
import { catalogCoordinator } from "./catalog-coordinator.js";
import { isChatModel, isPlaceholderModelId, ROUTER_PROVIDER_ID } from "./models.js";

export async function authorizedCatalog(cache = catalogCache) {
  try {
    return { rows: (await cache.get()).rows.filter(isChatModel), failures: [] };
  } catch (error) {
    return { rows: cache.snapshot().rows.filter(isChatModel), failures: [{ id: ROUTER_PROVIDER_ID, name: "Olares Router", message: error instanceof Error ? error.message : String(error) }] };
  }
}

export async function authorizedChatModel(selection, cache) {
  if (isPlaceholderModelId(selection.model)) return false;
  if (selection.provider !== ROUTER_PROVIDER_ID) return false;
  const { rows } = cache ? await cache.get() : catalogCoordinator.committed ?? { rows: [] };
  return rows.some((row) => row.id === selection.model && isChatModel(row));
}

export function routerReasoningSnapshot() { return catalogCoordinator.committed?.rows ?? []; }

export function routerReasoningInfo(provider, id, rows = routerReasoningSnapshot()) {
  if (provider !== ROUTER_PROVIDER_ID) return {};
  const row = rows.find((row) => row.id === id);
  if (!row?.reasoningEfforts) return { reasoning: undefined };
  const efforts = Object.keys(row.reasoningEfforts).map((id) => ({ id, name: id }));
  return { reasoning: { efforts, ...(row.reasoningDefault ? { defaultEffort: row.reasoningDefault } : {}) } };
}

export function routerReasoningPayload(payload, id, effort, rows = routerReasoningSnapshot()) {
  const next = { ...payload };
  if (effort === undefined) {
    delete next.reasoning_effort;
    return next;
  }
  const wire = rows.find((row) => row.id === id)?.reasoningEfforts?.[effort];
  if (wire !== effort) throw new Error(`Unsupported reasoning effort: ${effort}`);
  next.reasoning_effort = wire;
  return next;
}

export function normalizeRouterSelection(selection, rows = routerReasoningSnapshot()) {
  if (selection?.provider !== ROUTER_PROVIDER_ID || selection.reasoningEffort !== "off") return selection;
  const efforts = rows.find((row) => row.id === selection.model)?.reasoningEfforts;
  if (!efforts || Object.hasOwn(efforts, "off") || !Object.hasOwn(efforts, "none")) return selection;
  return { ...selection, reasoningEffort: "none" };
}

export async function restoreRouterSelection(selection, save, rows = routerReasoningSnapshot()) {
  const next = normalizeRouterSelection(selection, rows);
  if (next !== selection) await save(next);
  return next;
}
