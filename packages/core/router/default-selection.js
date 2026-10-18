import { ROUTER_PROVIDER_ID, isPlaceholderModelId } from "./models.js";

export function resolveDefaultSelection(current, models) {
  if (!models.length || current?.provider === ROUTER_PROVIDER_ID && models.some(model => model.id === current.model && !isPlaceholderModelId(model.id))) return current;
  const first = models.find(model => !isPlaceholderModelId(model.id));
  return first ? { provider: ROUTER_PROVIDER_ID, model: first.id } : current;
}

const pending = new WeakMap();
export async function ensureDefaultSelection(service, models) {
  if (!service) return;
  if (pending.has(service)) {
    await pending.get(service);
    return ensureDefaultSelection(service, models);
  }
  const current = service.currentSelection();
  const next = resolveDefaultSelection(current, models);
  if (next === current) return;
  const task = service.saveSelection(next, { expected: current });
  pending.set(service, task);
  try { await task; } finally { if (pending.get(service) === task) pending.delete(service); }
}
