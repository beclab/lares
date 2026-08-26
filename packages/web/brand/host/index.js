/** Brand: index.html tap (splash before client plugins), mark/manifest, LLM identity. */
import { PRODUCT_NAME, THEME_COLOR, identityPrompt, surfacePrompt } from "@lares/core/brand/identity";
import { loopbackWebUrl } from "@lares/core/olares/entrance";
import { BRAND_CSS } from "./stylesheet.js";
import { MANIFEST, MANIFEST_PATH, MARK_PATH, MARK_SVG } from "./mark.js";

export const name = "lares-brand";
export const inject = ["webServer"];

const DSH_WEB_URL = "DSH_WEB_URL";

function serve(body, contentType) {
  return (_req, res) => {
    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": "public, max-age=3600",
    });
    res.end(body);
  };
}

/** @param {import("@deepseek-ai/cordis").Context} ctx */
function localWebUrl(ctx) {
  return loopbackWebUrl(ctx.get("webServer")?.port);
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({ kind: "exact", path: MARK_PATH, handler: serve(MARK_SVG, "image/svg+xml") }),
    "lares-brand-mark",
  );
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: MANIFEST_PATH,
        handler: serve(JSON.stringify(MANIFEST), "application/manifest+json"),
      }),
    "lares-brand-manifest",
  );

  ctx.webServer.tapIndex((html) =>
    html
      .replace(/<title>[^<]*<\/title>/i, `<title>${PRODUCT_NAME}</title>`)
      .replace(/<link rel="icon"[^>]*>/i, `<link rel="icon" type="image/svg+xml" href="${MARK_PATH}" />`)
      .replace(/<link rel="manifest"[^>]*>/i, `<link rel="manifest" href="${MANIFEST_PATH}" />`)
      .replace(
        /<\/head>/i,
        `<meta name="theme-color" content="${THEME_COLOR}" /><style data-lares-brand>${BRAND_CSS}</style></head>`,
      ),
  );

  ctx.inject(["systemPrompt"], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: "harness:identity",
      order: -100,
      text: identityPrompt(),
    });
    promptCtx.systemPrompt.section({
      name: "app:web-surface",
      order: -98,
      text: () => surfacePrompt(localWebUrl(promptCtx)),
    });
  });

  ctx.inject(["shellEnv"], (runtimeCtx) => {
    runtimeCtx.shellEnv.register({
      name: "web-runtime",
      variables: {
        [DSH_WEB_URL]: { description: `Canonical local URL of ${PRODUCT_NAME} serving this session.` },
      },
      resolve: () => ({ [DSH_WEB_URL]: localWebUrl(runtimeCtx) }),
    });
  });
}
