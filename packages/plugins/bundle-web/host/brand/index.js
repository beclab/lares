/** Brand via index.html tap (splash before client plugins) + mark/manifest routes. */
import { BRAND_CSS } from "./stylesheet.js";
import { MANIFEST, MANIFEST_PATH, MARK_PATH, MARK_SVG } from "./mark.js";

export const name = "dina-brand";
export const inject = ["webServer"];

function serve(body, contentType) {
  return (_req, res) => {
    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": "public, max-age=3600",
    });
    res.end(body);
  };
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({ kind: "exact", path: MARK_PATH, handler: serve(MARK_SVG, "image/svg+xml") }),
    "dina-brand-mark",
  );
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: MANIFEST_PATH,
        handler: serve(JSON.stringify(MANIFEST), "application/manifest+json"),
      }),
    "dina-brand-manifest",
  );

  ctx.webServer.tapIndex((html) =>
    html
      .replace(/<title>[^<]*<\/title>/i, "<title>Dina</title>")
      .replace(/<link rel="icon"[^>]*>/i, `<link rel="icon" type="image/svg+xml" href="${MARK_PATH}" />`)
      .replace(/<link rel="manifest"[^>]*>/i, `<link rel="manifest" href="${MANIFEST_PATH}" />`)
      .replace(
        /<\/head>/i,
        `<meta name="theme-color" content="${MANIFEST.theme_color}" /><style data-dina-brand>${BRAND_CSS}</style></head>`,
      ),
  );
}
