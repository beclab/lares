import { WebError } from "@deepseek-ai/dsh-web";
import {
  SearchError,
  fetchRouterSearchModels,
  routerSearch as searchRouter,
  searchModelsFromRouterCatalog,
  searchSourcesFromRouter,
} from "@lares/core/router/search";

export { fetchRouterSearchModels, searchModelsFromRouterCatalog, searchSourcesFromRouter };

const WEB_CODES = {
  no_model: "WEB_PROVIDER_CONFIGURED_UNAVAILABLE",
  empty_query: "WEB_PROVIDER_ERROR",
  aborted: "WEB_ABORTED",
  timeout: "WEB_PROVIDER_ERROR",
  credential: "WEB_PROVIDER_CREDENTIAL_MISSING",
  failed: "WEB_PROVIDER_ERROR",
};

export async function routerSearch(model, query, opts) {
  try {
    return await searchRouter(model, query, opts);
  } catch (err) {
    if (err instanceof SearchError) {
      throw new WebError(err.message, WEB_CODES[err.code] ?? "WEB_PROVIDER_ERROR", { cause: err });
    }
    throw err;
  }
}
