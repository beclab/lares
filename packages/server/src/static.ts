import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import type { Hono } from "hono";

const MIME_TYPES: Record<string, string> = {
	".css": "text/css; charset=utf-8",
	".gif": "image/gif",
	".html": "text/html; charset=utf-8",
	".ico": "image/x-icon",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".ttf": "font/ttf",
	".txt": "text/plain; charset=utf-8",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

function contentType(path: string): string {
	return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function fileResponse(path: string, cacheable: boolean): Response {
	const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
	return new Response(stream, {
		headers: {
			"content-type": contentType(path),
			"content-length": String(statSync(path).size),
			"cache-control": cacheable ? "public, max-age=31536000, immutable" : "no-cache",
		},
	});
}

/**
 * Serve the built SPA with history fallback.
 *
 * Hashed build assets are immutable, so they get a long cache; everything else
 * including index.html must revalidate or a deploy would leave stale shells
 * pointing at assets that no longer exist.
 */
export function mountStatic(app: Hono, webRoot: string): void {
	const root = resolve(webRoot);
	const indexPath = join(root, "index.html");

	app.get("/*", (c) => {
		const requested = decodeURIComponent(new URL(c.req.url).pathname);
		const candidate = resolve(root, `.${normalize(requested)}`);
		const insideRoot = candidate === root || candidate.startsWith(root + sep);

		if (insideRoot && existsSync(candidate) && statSync(candidate).isFile()) {
			return fileResponse(candidate, candidate.includes(`${sep}assets${sep}`));
		}
		if (existsSync(indexPath)) return fileResponse(indexPath, false);
		return c.text("Web UI is not built. Run `npm run build -w @lares/web`.", 404);
	});
}
