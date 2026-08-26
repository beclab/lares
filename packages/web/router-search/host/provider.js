import { WebError } from "@deepseek-ai/dsh-web";
import { configuredSearchModel, LARES_PROVIDER_ID } from "@lares/core/search/config";
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
      return Boolean(configuredSearchModel());
    },
    async search(request, signal) {
      const model = configuredSearchModel();
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
