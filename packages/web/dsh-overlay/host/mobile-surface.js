/**
 * Phone browsers opening the Lares entrance get the mobile shell.
 * Desktop browsers keep the dsh fallback. Both stay on this host.
 */
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isMobileIndexPath,
  spaCacheControl,
  surfaceFromRequest,
  uiCookieHeader,
} from "@olares/lares-core/entrance/surface";

export const name = "lares-mobile-surface";
export const inject = ["webServer", "connection"];

const DIST = join(dirname(fileURLToPath(import.meta.url)), "../../../mobile/dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

let warnedMissing = false;

function mobileReady() {
  const ready = existsSync(join(DIST, "index.html"));
  if (!ready && !warnedMissing) {
    warnedMissing = true;
    console.warn(`[lares] mobile entrance missing ${DIST}/index.html; phones stay on the desktop shell`);
  }
  return ready;
}

function fileInside(pathname) {
  const rel = String(pathname ?? "/").replace(/\\/g, "/").replace(/^\/+/, "");
  const root = resolve(DIST);
  const target = resolve(normalize(join(root, rel)));
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

function stampUiCookie(res, surface) {
  if (!surface) return;
  res.setHeader("set-cookie", uiCookieHeader(surface));
  res.setHeader("accept-ch", "Sec-CH-UA-Mobile");
}

async function serveMobile(req, res, ctx) {
  const url = new URL(req.url ?? "/", "http://lares.invalid");
  const index = isMobileIndexPath(url.pathname);
  const target = fileInside(index ? "/index.html" : url.pathname);
  if (!target) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (index && !ctx.connection.authorizeIndex(req, res)) return;

  let body;
  try {
    const info = await stat(target);
    if (!info.isFile()) throw Object.assign(new Error("not a file"), { code: "EISDIR" });
    body = await readFile(target);
  } catch (err) {
    if (err?.code === "ENOENT" || err?.code === "EISDIR" || err?.code === "ENOTDIR") {
      res.writeHead(404);
      res.end();
      return;
    }
    throw err;
  }

  const cache = spaCacheControl(index ? "index.html" : url.pathname);
  const headers = {
    "content-type": index ? MIME[".html"] : (MIME[extname(target)] ?? "application/octet-stream"),
    "cache-control": cache,
  };
  if (cache.startsWith("no-cache")) headers.pragma = "no-cache";
  res.writeHead(200, headers);
  res.end(req.method === "HEAD" ? undefined : body);
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  let timer;
  let wrapped;
  const arm = () => {
    const server = ctx.webServer;
    const current = server?.fallback;
    if (!current || current.__laresMobile) return Boolean(current?.__laresMobile);
    const previous = current;
    wrapped = async (req, res) => {
      const choice = surfaceFromRequest(req);
      stampUiCookie(res, choice.setCookie);
      const phone = choice.surface === "mobile" && mobileReady()
        && (req.method === "GET" || req.method === "HEAD");
      if (!phone) {
        await previous(req, res);
        return;
      }
      await serveMobile(req, res, ctx);
    };
    wrapped.__laresMobile = true;
    wrapped.previous = previous;
    server.fallback = wrapped;
    return true;
  };

  if (!arm()) {
    timer = setInterval(() => {
      if (arm()) clearInterval(timer);
    }, 50);
  }
  ctx.effect(() => () => {
    clearInterval(timer);
    const server = ctx.webServer;
    if (wrapped && server?.fallback === wrapped) server.fallback = wrapped.previous;
  }, "lares-mobile-surface");
}
