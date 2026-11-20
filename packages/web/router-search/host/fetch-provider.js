import { configuredFetchModel, fetchDisabled } from "@olares/lares-core/fetch/config";
import { Config as HttpFetchConfig, HttpFetchProvider } from "@deepseek-ai/dsh-web-fetch-http";
import { WebError } from "@deepseek-ai/dsh-web";
import { routerScrape, ScrapeError, scrapeWebErrorCode } from "@olares/lares-core/router/scrape";

/**
 * Router returns extracted Markdown as text, so dsh-tool-web must not parse it
 * as HTML again. Search enablement does not control this separate capability.
 * Direct uses DSH public HTTP(S) fetching without Router.
 * @param {import('@deepseek-ai/dsh-web').WebFetchProvider} [httpProvider]
 * @returns {import('@deepseek-ai/dsh-web').WebFetchProvider}
 */
export function createLaresFetchProvider(httpProvider = new HttpFetchProvider(HttpFetchConfig({}))) {
  return {
    id: "lares",
    available() { return fetchDisabled() ? httpProvider.available() : true; },
    async fetch(request, signal) {
      if (fetchDisabled()) {
        return httpProvider.fetch(request, signal);
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
