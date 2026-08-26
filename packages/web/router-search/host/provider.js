import { WebError } from "@deepseek-ai/dsh-web";
import { LARES_PROVIDER_ID, readConfig } from "@lares/core/search/config";
import { routerSearch } from "./router.js";

export { LARES_PROVIDER_ID };

/**
 * Facade SearchProvider: one dsh seam backed by the selected Router search model.
 * @returns {import('@deepseek-ai/dsh-web').WebSearchProvider}
 */
export function createLaresSearchProvider() {
  return {
    id: LARES_PROVIDER_ID,
    available() {
      return Boolean(readConfig().defaultSearchModel);
    },
    async search(request, signal) {
      const model = readConfig().defaultSearchModel;
      if (!model) {
        throw new WebError(
          "No Router search service selected as default",
          "WEB_PROVIDER_CONFIGURED_UNAVAILABLE",
        );
      }
      return routerSearch(model, request.query, {
        maxResults: request.maxResults,
        signal,
      });
    },
  };
}
