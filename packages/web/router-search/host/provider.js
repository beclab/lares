import { WebError } from "@deepseek-ai/dsh-web";
import { configuredSearchModel, LARES_PROVIDER_ID, searchDisabled } from "@olares/lares-core/search/config";
import { ROUTER_DEFAULT_SEARCH_ROUTE, routerSearch } from "./router.js";

export { LARES_PROVIDER_ID };

/**
 * Facade SearchProvider: one dsh seam backed by Router.
 *
 * `available()` is a synchronous seam, so it cannot consult the catalog. Only
 * the user turning search off answers no here; an unconfigured default follows
 * Router's own category and lets Router refuse it when nothing stands behind
 * it, which is a reason the caller can read.
 * @returns {import('@deepseek-ai/dsh-web').WebSearchProvider}
 */
export function createLaresSearchProvider() {
  return {
    id: LARES_PROVIDER_ID,
    available() {
      return !searchDisabled();
    },
    async search(request, signal) {
      if (searchDisabled()) {
        throw new WebError(
          "Web search is turned off in Lares settings",
          "WEB_PROVIDER_CONFIGURED_UNAVAILABLE",
        );
      }
      return routerSearch(configuredSearchModel() ?? ROUTER_DEFAULT_SEARCH_ROUTE, request.query, {
        maxResults: request.maxResults,
        signal,
      });
    },
  };
}
