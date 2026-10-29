import { ROUTER_PROVIDER_ID, isPlaceholderModelId } from "./models.js";

/**
 * `preferred` is the model Router's default-chat targets. While the catalog lists it, the default for
 * new Sessions follows it, so changing the default in Router (or Router repointing it when an engine
 * stops) reaches Lares without a second setting.
 */
export function resolveDefaultSelection(current, models, preferred = null) {
  if (preferred && !isPlaceholderModelId(preferred) && models.some((model) => model.id === preferred)) {
    return current?.provider === ROUTER_PROVIDER_ID && current.model === preferred ? current : { provider: ROUTER_PROVIDER_ID, model: preferred };
  }
  if (!models.length || current?.provider === ROUTER_PROVIDER_ID && models.some(model => model.id === current.model && !isPlaceholderModelId(model.id))) return current;
  const first = models.find(model => !isPlaceholderModelId(model.id));
  return first ? { provider: ROUTER_PROVIDER_ID, model: first.id } : current;
}

const pending = new WeakMap();
export async function ensureDefaultSelection(service, models, preferred = null) {
  if (!service) return;
  if (pending.has(service)) {
    await pending.get(service);
    return ensureDefaultSelection(service, models, preferred);
  }
  const current = service.currentSelection();
  const next = resolveDefaultSelection(current, models, preferred);
  if (next === current) return;
  const task = service.saveSelection(next, { expected: current });
  pending.set(service, task);
  try { await task; } finally { if (pending.get(service) === task) pending.delete(service); }
}
