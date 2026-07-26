import { createReadStream } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import type { DirEntry, FileContent, FileMeta } from "@lares/shared";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { convertToHtml } from "mammoth";
import { buildIndex, search } from "../files/index-builder.ts";
import { languageOf, looksBinary, mimeOf, previewKindOf } from "../files/kinds.ts";
import { PathDenied, resolveInWorkspace, workspaceRoot } from "../files/paths.ts";

/** Big enough for any source file, small enough not to wedge the browser. */
const TEXT_MAX_BYTES = 512 * 1024;
const BINARY_SNIFF_BYTES = 4096;
const INDEX_RESULT_LIMIT = 30;

const HIDDEN_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "target", "__pycache__", ".venv"]);

function relativeTo(root: string, path: string): string {
	const rel = relative(root, path);
	return rel === "" ? "." : rel;
}

async function listDirectory(root: string, dir: string): Promise<DirEntry[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const results: DirEntry[] = [];

	for (const entry of entries) {
		if (HIDDEN_DIRS.has(entry.name)) continue;
		const full = join(dir, entry.name);

		let info: Awaited<ReturnType<typeof stat>>;
		try {
			info = await stat(full);
		} catch {
			// Broken symlinks and races during a build: skip rather than fail the listing.
			continue;
		}

		results.push({
			name: entry.name,
			path: relativeTo(root, full),
			isDir: info.isDirectory(),
			size: info.size,
			modified: info.mtime.toISOString(),
		});
	}

	// Directories first, then case-insensitive by name, which is what a file
	// manager does and what makes a deep tree scannable.
	results.sort(
		(a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
	);
	return results;
}

async function describe(root: string, path: string): Promise<FileMeta> {
	const info = await stat(path);
	const previewKind = previewKindOf(path);

	let tooLarge = info.size > TEXT_MAX_BYTES;
	if (!tooLarge && (previewKind === "text" || previewKind === "markdown" || previewKind === "notebook")) {
		const handle = await open(path, "r");
		try {
			const buffer = Buffer.alloc(Math.min(BINARY_SNIFF_BYTES, info.size));
			await handle.read(buffer, 0, buffer.length, 0);
			tooLarge = looksBinary(buffer);
		} finally {
			await handle.close();
		}
	}

	return {
		path: relativeTo(root, path),
		size: info.size,
		modified: info.mtime.toISOString(),
		language: languageOf(path),
		mime: mimeOf(path),
		previewKind,
		tooLarge,
	};
}

export function createFileRoutes(workspace: string): Hono {
	const app = new Hono();

	const inWorkspace = (requested: string | undefined): string => resolveInWorkspace(workspace, requested);
	const root = workspaceRoot(workspace);

	app.onError((err, c) => {
		if (err instanceof PathDenied) return c.json({ error: err.message }, 403);
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes("ENOENT")) return c.json({ error: "No such file or directory" }, 404);
		return c.json({ error: message }, 500);
	});

	app.get("/list", async (c) => {
		const target = inWorkspace(c.req.query("path"));
		const info = await stat(target);
		if (!info.isDirectory()) return c.json({ error: "Not a directory" }, 400);

		const rel = relativeTo(root, target);
		return c.json({
			path: rel,
			parent: rel === "." ? null : relativeTo(root, dirname(target)),
			entries: await listDirectory(root, target),
		});
	});

	app.get("/meta", async (c) => c.json(await describe(root, inWorkspace(c.req.query("path")))));

	app.get("/read", async (c) => {
		const target = inWorkspace(c.req.query("path"));
		const meta = await describe(root, target);

		if (meta.tooLarge) return c.json({ error: "File is binary or too large to display", meta }, 413);
		if (meta.previewKind !== "text" && meta.previewKind !== "markdown" && meta.previewKind !== "notebook") {
			return c.json({ error: "Use /raw for this file type", meta }, 415);
		}

		const content: FileContent = { ...meta, content: await readFile(target, "utf8") };
		return c.json(content);
	});

	/** Streams the bytes as-is, which is what <img>, <audio> and <embed> need. */
	app.get("/raw", async (c) => {
		const target = inWorkspace(c.req.query("path"));
		const info = await stat(target);
		const download = c.req.query("download") === "1";

		c.header("content-type", mimeOf(target));
		c.header("content-length", String(info.size));
		c.header(
			"content-disposition",
			`${download ? "attachment" : "inline"}; filename="${basename(target).replace(/"/g, "")}"`,
		);

		return stream(c, async (writable) => {
			for await (const chunk of createReadStream(target)) writable.write(chunk as Uint8Array);
		});
	});

	/** DOCX has no browser-native viewer, so it is converted to HTML here. */
	app.get("/docx", async (c) => {
		const target = inWorkspace(c.req.query("path"));
		const { value } = await convertToHtml({ path: target });
		return c.json({ html: value });
	});

	app.get("/index", async (c) => {
		const cwd = inWorkspace(c.req.query("cwd"));
		const query = (c.req.query("q") ?? "").slice(0, 200);
		const { files, truncated } = await buildIndex(cwd);
		return c.json({ files: search(files, query, INDEX_RESULT_LIMIT), truncated });
	});

	return app;
}
