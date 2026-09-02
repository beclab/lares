/** The model facts Lares's settings panel reads and writes. */
import {
  catalogRevision,
  catalogState,
  currentDefault as readDefault,
  listCatalog as listCatalogCore,
  onCatalogRevision,
  refreshCatalog as refreshCatalogCore,
  saveDefault as saveDefaultCore,
} from "@olares/lares-core/router/catalog-sync";

export { catalogRevision, onCatalogRevision };

export {
  chatModelsFromRouterCatalog,
  pickDefaultModel,
} from "@olares/lares-core/router/models";

/** @param {import('@deepseek-ai/cordis').Context} ctx */
function catalogPorts(ctx) {
  return {
    mutateSettings: (ns, ops) => ctx.settings.mutate(ns, ops),
    currentSelection: () => ctx.agentDefaultModel.currentSelection(),
    saveSelection: (next) => ctx.agentDefaultModel.saveSelection(next),
    listProviders: () => ctx.llm.listProviders(),
    listModels: (provider) => ctx.llm.listModels(provider),
    resolveCallConfig: (asked) => ctx.llm.resolveCallConfig(asked),
  };
}

/** Coalesce concurrent refresh requests so catalog/default updates cannot interleave. */
export function refreshCatalog(ctx) {
  return refreshCatalogCore(catalogPorts(ctx));
}

/**
 * Router chat models the Host can route.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @returns {Promise<{ models: object[], failures: object[] }>}
 */
export function listCatalog(ctx) {
  return listCatalogCore(catalogPorts(ctx));
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @returns {{ provider: string, model: string }}
 */
export function currentDefault(ctx) {
  return readDefault(catalogPorts(ctx));
}

/**
 * Save what future sessions start from — the same `agent-default-model` section
 * the composer chip writes when it switches a session.
 *
 * No reasoning effort travels with the selection: the Router route declares its
 * models by hand, and a hand-declared model rejects every explicit level.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ provider?: unknown, model?: unknown }} request
 * @returns {Promise<{ provider: string, model: string }>}
 */
export function saveDefault(ctx, request) {
  return saveDefaultCore(catalogPorts(ctx), request);
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export async function catalogPanelState(ctx) {
  return catalogState(catalogPorts(ctx), await listCatalog(ctx));
}
