import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { gitListFiles, repositoryRoot } from "./git.ts";

const MAX_FILES = 20_000;
const MAX_DEPTH = 8;
const CACHE_TTL_MS = 10_000;

const SKIP = new Set([
	"node_modules",
	".git",
	".next",
	"dist",
	"build",
	"target",
	"vendor",
	"coverage",
	"__pycache__",
	".venv",
	".turbo",
	".cache",
	".pytest_cache",
	".mypy_cache",
]);

interface CacheEntry {
	files: string[];
	truncated: boolean;
	builtAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Breadth-first so a shallow, useful slice survives when the cap is hit. */
async function walk(root: string): Promise<{ files: string[]; truncated: boolean }> {
	const files: string[] = [];
	let queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];

	while (queue.length > 0 && files.length < MAX_FILES) {
		const next: typeof queue = [];

		for (const { dir, depth } of queue) {
			let entries: Dirent[];
			try {
				entries = await readdir(dir, { withFileTypes: true });
			} catch {
				continue;
			}

			for (const entry of entries) {
				if (SKIP.has(entry.name)) continue;
				const full = join(dir, entry.name);

				if (entry.isDirectory()) {
					if (depth < MAX_DEPTH) next.push({ dir: full, depth: depth + 1 });
					continue;
				}
				if (files.length >= MAX_FILES) break;
				files.push(relative(root, full));
			}
		}

		queue = next;
	}

	return { files, truncated: files.length >= MAX_FILES };
}

export async function buildIndex(cwd: string): Promise<{ files: string[]; truncated: boolean }> {
	const cached = cache.get(cwd);
	if (cached && Date.now() - cached.builtAt < CACHE_TTL_MS) {
		return { files: cached.files, truncated: cached.truncated };
	}

	const root = await repositoryRoot(cwd);
	const tracked = root === cwd ? await gitListFiles(cwd) : null;
	const result = tracked ? { files: tracked, truncated: tracked.length >= MAX_FILES } : await walk(cwd);

	cache.set(cwd, { ...result, builtAt: Date.now() });
	return result;
}

export function invalidateIndex(cwd: string): void {
	cache.delete(cwd);
}

/**
 * Ranks paths the way pi's own autocomplete does, so muscle memory carries over
 * from the TUI: exact name beats prefix beats substring beats subsequence.
 */
export function score(path: string, query: string): number {
	if (!query) return 1;

	const haystack = path.toLowerCase();
	const needle = query.toLowerCase();
	const name = haystack.slice(haystack.lastIndexOf("/") + 1);

	if (name === needle) return 100;
	if (name.startsWith(needle)) return 80;
	if (name.includes(needle)) return 50;
	if (haystack.includes(needle)) return 30;

	let cursor = 0;
	for (const char of needle) {
		cursor = haystack.indexOf(char, cursor) + 1;
		if (cursor === 0) return 0;
	}
	return 10;
}

export function search(files: string[], query: string, limit: number): string[] {
	if (!query) return files.slice(0, limit);

	const scored: { path: string; score: number }[] = [];
	for (const path of files) {
		const value = score(path, query);
		if (value > 0) scored.push({ path, score: value });
	}

	// Shorter paths win ties: they are closer to the root and usually the target.
	scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
	return scored.slice(0, limit).map((entry) => entry.path);
}
