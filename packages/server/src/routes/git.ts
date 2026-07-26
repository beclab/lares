import { readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { GitDiffResponse } from "@lares/shared";
import { Hono } from "hono";
import { gitDiff, gitStatus } from "../files/git.ts";
import { looksBinary } from "../files/kinds.ts";
import { PathDenied, resolveInWorkspace } from "../files/paths.ts";

const DIFF_MAX_BYTES = 512 * 1024;

export function createGitRoutes(workspace: string): Hono {
	const app = new Hono();

	app.onError((err, c) => {
		if (err instanceof PathDenied) return c.json({ error: err.message }, 403);
		return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
	});

	app.get("/status", async (c) => {
		const cwd = resolveInWorkspace(workspace, c.req.query("cwd"));
		return c.json(await gitStatus(cwd));
	});

	app.get("/diff", async (c) => {
		const cwd = resolveInWorkspace(workspace, c.req.query("cwd"));
		const target = resolveInWorkspace(workspace, c.req.query("path"));

		const status = await gitStatus(cwd);
		if (!status.isRepository || !status.root) {
			return c.json<GitDiffResponse>({ supported: false, reason: "Not a git repository" });
		}

		const relativePath = relative(status.root, target);
		const change = status.changes.find((entry) => join(status.root as string, entry.path) === target);
		if (!change) return c.json<GitDiffResponse>({ supported: false, reason: "No pending changes for this file" });

		if (change.status === "deleted") {
			return c.json<GitDiffResponse>({ supported: false, status: change.status, reason: "File was deleted" });
		}

		const info = await stat(target).catch(() => null);
		if (!info) return c.json<GitDiffResponse>({ supported: false, status: change.status, reason: "File is missing" });
		if (info.size > DIFF_MAX_BYTES) {
			return c.json<GitDiffResponse>({ supported: false, status: change.status, reason: "File is too large to diff" });
		}

		const untracked = change.status === "untracked";
		const content = untracked ? await readFile(target, "utf8") : undefined;
		if (content !== undefined && looksBinary(Buffer.from(content.slice(0, 4096)))) {
			return c.json<GitDiffResponse>({ supported: false, status: change.status, reason: "File is binary" });
		}

		const patch = await gitDiff(status.root, relativePath, untracked, content);
		if (!patch.includes("@@")) {
			return c.json<GitDiffResponse>({ supported: false, status: change.status, reason: "Diff is empty" });
		}

		return c.json<GitDiffResponse>({ supported: true, status: change.status, patch });
	});

	return app;
}
