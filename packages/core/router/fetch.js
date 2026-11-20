import { catalogCache } from "./catalog-cache.js";
import { routerCatalogRows } from "./catalog.js";

export function fetchModelsFromRouterCatalog(payload) {
  return routerCatalogRows(payload)
    .filter((model) => model.mode === "scrape")
    .map(({ id, name }) => ({ id, name }));
}

export async function fetchRouterFetchModels(options = {}) {
  const { payload } = await catalogCache.get(options);
  return fetchModelsFromRouterCatalog(payload);
}
