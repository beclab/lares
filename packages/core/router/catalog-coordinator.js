import { ensureDefaultSelection } from "./default-selection.js";
import { catalogCache } from "./catalog-cache.js";
import { chatModelsFromRouterCatalog, catalogSettingsOps, LLM_SETTINGS_NS } from "./models.js";

export class CatalogCoordinator {
  constructor(cache = catalogCache) {
    this.cache = cache;
    this.committed = null;
    this.signature = null;
    this.revision = 0;
    this.listeners = new Set();
    this.inflight = null;
  }

  async sync(ports, refresh = false) {
    if (this.inflight) {
      const pending = this.inflight;
      const result = await pending.promise;
      await ensureDefaultSelection(ports.defaultModel, result.models);
      if (!refresh || pending.refresh) return result;
      return this.sync(ports, true);
    }
    const pending = { refresh, promise: null };
    pending.promise = this.perform(ports, refresh).finally(() => {
      if (this.inflight === pending) this.inflight = null;
    });
    this.inflight = pending;
    return pending.promise;
  }

  async perform(ports, refresh) {
    const previous = this.cache.snapshot();
    try {
      const next = await this.cache.get({ refresh });
      const models = chatModelsFromRouterCatalog(next.payload);
      const signature = JSON.stringify(next.rows);
      // Readers cannot observe new capabilities until dsh accepts the same catalog.
      if (signature !== this.signature) {
        await ports.mutateSettings(LLM_SETTINGS_NS, catalogSettingsOps(models));
        await ensureDefaultSelection(ports.defaultModel, models);
        this.committed = { ...next, models };
        this.signature = signature;
        this.revision++;
        for (const listener of this.listeners) listener(this.revision);
      } else {
        await ensureDefaultSelection(ports.defaultModel, models);
      }
      return this.committed;
    } catch (error) {
      this.cache.restore(previous);
      throw error;
    }
  }
}

export const catalogCoordinator = new CatalogCoordinator();

export function synchronizeHostCatalog(ctx, refresh = false) {
  return catalogCoordinator.sync({ mutateSettings: (ns, ops) => ctx.settings.mutate(ns, ops), defaultModel: ctx.agentDefaultModel }, refresh);
}
