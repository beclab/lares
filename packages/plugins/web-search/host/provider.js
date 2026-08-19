import { WebError } from "@deepseek-ai/dsh-web";
import { providerReady, readConfig } from "./config.js";
import { customSearch } from "./providers/custom.js";
import { tavilySearch } from "./providers/tavily.js";

/** Stable id registered with ctx.web; routes to the user-selected backend. */
export const DINA_PROVIDER_ID = "dina";

/**
 * Facade SearchProvider: one seam id, many configured backends.
 * @returns {import('@deepseek-ai/dsh-web').WebSearchProvider}
 */
export function createDinaSearchProvider() {
  return {
    id: DINA_PROVIDER_ID,
    available() {
      return providerReady(readConfig());
    },
    async search(request, signal) {
      const config = readConfig();
      const id = config.defaultProvider;
      if (!providerReady(config, id)) {
        throw new WebError(
          id
            ? `Web search provider "${id}" is not configured`
            : "No web search provider selected as default",
          "WEB_PROVIDER_CONFIGURED_UNAVAILABLE",
        );
      }

      if (id === "tavily") {
        return tavilySearch(config.providers.tavily.apiKey, request.query, {
          maxResults: request.maxResults,
          signal,
        });
      }

      return customSearch({
        url: config.providers.custom.url,
        apiKey: config.providers.custom.apiKey,
        protocol: "dina",
        query: request.query,
        maxResults: request.maxResults,
        signal,
      });
    },
  };
}
