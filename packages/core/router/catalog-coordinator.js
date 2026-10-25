import { ensureDefaultSelection } from "./default-selection.js";
import { catalogCache } from "./catalog-cache.js";
import { defaultChatTarget } from "./default-route.js";
import { chatModelsFromRouterCatalog, catalogSettingsOps, LLM_SETTINGS_NS } from "./models.js";

export class CatalogCoordinator {
  constructor(cache = catalogCache) {
    this.cache = cache;
    this.committed = null;
    this.signature = null;
    this.revision = 0;
    this.listeners = new Set();
    this.inflight = null;
    this.preferred = null;
    this.preferredAt = -Infinity;
  }

  async sync(ports, refresh = false) {
    if (this.inflight) {
      const pending = this.inflight;
      const result = await pending.promise;
      await ensureDefaultSelection(ports.defaultModel, result.models, this.preferred);
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
      // Read apart from the rows: Router can repoint default-chat between models that both stay
      // listed. Cached like the catalog, since every Agent prompt passes through here.
      const now = this.cache.now();
      if (refresh || now - this.preferredAt >= this.cache.ttlMs) {
        this.preferred = ports.defaultChat ? await ports.defaultChat() : null;
        this.preferredAt = now;
      }
      // Readers cannot observe new capabilities until dsh accepts the same catalog.
      if (signature !== this.signature) {
        await ports.mutateSettings(LLM_SETTINGS_NS, catalogSettingsOps(models));
        await ensureDefaultSelection(ports.defaultModel, models, this.preferred);
        this.committed = { ...next, models };
        this.signature = signature;
        this.revision++;
        for (const listener of this.listeners) listener(this.revision);
      } else {
        await ensureDefaultSelection(ports.defaultModel, models, this.preferred);
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
  return catalogCoordinator.sync({ mutateSettings: (ns, ops) => ctx.settings.mutate(ns, ops), defaultModel: ctx.agentDefaultModel, defaultChat: () => defaultChatTarget() }, refresh);
}
