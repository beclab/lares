import { configuredFetchModel, fetchDisabled } from "@olares/lares-core/fetch/config";
import { WebError } from "@deepseek-ai/dsh-web";
import { routerScrape, ScrapeError, scrapeWebErrorCode } from "@olares/lares-core/router/scrape";

/**
 * Router returns extracted Markdown as text, so dsh-tool-web must not parse it
 * as HTML again. Search enablement does not control this separate capability.
 * @returns {import('@deepseek-ai/dsh-web').WebFetchProvider}
 */
export function createLaresFetchProvider() {
  return {
    id: "lares",
    available() { return !fetchDisabled(); },
    async fetch(request, signal) {
      if (fetchDisabled()) {
        throw new WebError("Web fetch is turned off in Lares settings", "WEB_PROVIDER_CONFIGURED_UNAVAILABLE");
      }
      try {
        return await routerScrape(request.url, { signal, model: configuredFetchModel() ?? undefined });
      } catch (err) {
        if (err instanceof ScrapeError) {
          throw new WebError(err.message, scrapeWebErrorCode(err.code), { cause: err });
        }
        throw err;
      }
    },
  };
}
