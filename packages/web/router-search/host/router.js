import { WebError } from "@deepseek-ai/dsh-web";
import {
  SearchError,
  fetchRouterSearchModels,
  routerSearch as searchRouter,
  searchModelsFromRouterCatalog,
  searchSourcesFromRouter,
  searchWebErrorCode,
} from "@olares/lares-core/router/search";

export { fetchRouterSearchModels, searchModelsFromRouterCatalog, searchSourcesFromRouter };

export async function routerSearch(model, query, opts) {
  try {
    return await searchRouter(model, query, opts);
  } catch (err) {
    if (err instanceof SearchError) {
      throw new WebError(err.message, searchWebErrorCode(err.code), { cause: err });
    }
    throw err;
  }
}
