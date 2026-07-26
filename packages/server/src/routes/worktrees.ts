import type { WorktreeListResponse } from "@lares/shared";
import { Hono } from "hono";
import { PathDenied, resolveInWorkspace } from "../files/paths.ts";
import { addWorktree, describeRepo, listWorktrees, removeWorktree, WorktreeError } from "../files/worktree.ts";

export function createWorktreeRoutes(workspace: string): Hono {
	const app = new Hono();

	app.onError((err, c) => {
		if (err instanceof PathDenied) return c.json({ error: err.message }, 403);
		if (err instanceof WorktreeError) {
			return c.json({ error: err.message, code: err.code }, err.code === "dirty" ? 409 : 400);
		}
		return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
	});

	app.get("/", async (c) => {
		const cwd = resolveInWorkspace(workspace, c.req.query("cwd"));
		const repo = await describeRepo(cwd);
		if (!repo) {
			return c.json<WorktreeListResponse>({ isRepository: false, mainRoot: null, current: null, worktrees: [] });
		}

		return c.json<WorktreeListResponse>({
			isRepository: true,
			mainRoot: repo.mainRoot,
			current: repo.toplevel,
			worktrees: await listWorktrees(repo.mainRoot),
		});
	});

	app.post("/", async (c) => {
		const body = (await c.req.json().catch(() => null)) as {
			cwd?: unknown;
			branch?: unknown;
			startPoint?: unknown;
		} | null;
		const branch = typeof body?.branch === "string" ? body.branch : "";
		if (!branch.trim()) return c.json({ error: "branch is required" }, 400);

		const cwd = resolveInWorkspace(workspace, typeof body?.cwd === "string" ? body.cwd : undefined);
		const created = await addWorktree({
			workspace,
			cwd,
			branch,
			...(typeof body?.startPoint === "string" && body.startPoint ? { startPoint: body.startPoint } : {}),
		});

		return c.json(created, 201);
	});

	app.delete("/", async (c) => {
		const body = (await c.req.json().catch(() => null)) as { path?: unknown; force?: unknown } | null;
		const requested = typeof body?.path === "string" ? body.path : "";
		if (!requested) return c.json({ error: "path is required" }, 400);

		const path = resolveInWorkspace(workspace, requested);
		const repo = await describeRepo(path);
		if (!repo) return c.json({ error: `${requested} is not a git checkout` }, 400);

		await removeWorktree(repo.mainRoot, path, body?.force === true);
		return c.json({ removed: path });
	});

	return app;
}
