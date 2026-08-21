import { WebError } from "@deepseek-ai/dsh-web";
import { readConfig } from "./config.js";
import { routerSearch } from "./router.js";

/** Stable id registered with ctx.web; routes to the selected Router service. */
export const LARES_PROVIDER_ID = "lares";

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
