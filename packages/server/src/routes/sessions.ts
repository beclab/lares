import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContextEntries, type SessionInfo, SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionSummary } from "@lares/shared";
import { Hono } from "hono";
import type { SessionRegistry } from "../pi-bridge/session-registry.ts";
import { repairHtmlExport } from "../sessions/export.ts";
import { forkPoints, toTree } from "../sessions/tree.ts";

function toSummary(info: SessionInfo): SessionSummary {
	return {
		id: info.id,
		path: info.path,
		cwd: info.cwd,
		...(info.name ? { name: info.name } : {}),
		...(info.parentSessionPath ? { parentSessionPath: info.parentSessionPath } : {}),
		created: info.created.toISOString(),
		modified: info.modified.toISOString(),
		messageCount: info.messageCount,
		firstMessage: info.firstMessage,
	};
}

async function findSession(id: string): Promise<SessionInfo | undefined> {
	const all = await SessionManager.listAll();
	return all.find((entry) => entry.id === id);
}

export function createSessionRoutes(registry: SessionRegistry): Hono {
	const app = new Hono();

	app.get("/", async (c) => {
		const all = await SessionManager.listAll();
		const sessions = all.map(toSummary).sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
		return c.json({ sessions, runningSessionIds: registry.runningIds() });
	});

	app.get("/:id", async (c) => {
		const id = c.req.param("id");
		const info = await findSession(id);
		if (!info) return c.json({ error: `Unknown session ${id}` }, 404);

		const manager = SessionManager.open(info.path);
		const entries = buildContextEntries(manager.getEntries(), manager.getLeafId());
		return c.json({ session: toSummary(info), entries, leafId: manager.getLeafId() });
	});

	app.get("/:id/tree", async (c) => {
		const id = c.req.param("id");
		const info = await findSession(id);
		if (!info) return c.json({ error: `Unknown session ${id}` }, 404);

		const manager = SessionManager.open(info.path);
		const leafId = manager.getLeafId();
		return c.json({
			roots: toTree(manager.getTree(), leafId),
			leafId,
			forkPoints: forkPoints(manager.getEntries()),
		});
	});

	app.post("/:id/name", async (c) => {
		const id = c.req.param("id");
		const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null;
		const name = typeof body?.name === "string" ? body.name.trim() : "";
		if (!name) return c.json({ error: "name is required" }, 400);

		// A live session owns the file handle, so renaming through it keeps the
		// in-memory copy and the file in agreement.
		const live = registry.get(id);
		if (live) {
			await live.send({ type: "set_session_name", name });
			return c.json({ name });
		}

		const info = await findSession(id);
		if (!info) return c.json({ error: `Unknown session ${id}` }, 404);
		SessionManager.open(info.path).appendSessionInfo(name);
		return c.json({ name });
	});

	app.delete("/:id", async (c) => {
		const id = c.req.param("id");
		const info = await findSession(id);
		if (!info) return c.json({ error: `Unknown session ${id}` }, 404);

		registry.close(id);
		await rm(info.path, { force: true });
		return c.json({ deleted: id });
	});

	/**
	 * Copies the path from the root to one entry into a fresh session file. The
	 * original keeps every branch, so forking is never destructive.
	 *
	 * `mode: "before"` stops short of the entry, which is how "restart from this
	 * message" works: the prompt is left out so the user can rewrite it.
	 */
	app.post("/:id/fork", async (c) => {
		const id = c.req.param("id");
		const body = (await c.req.json().catch(() => null)) as { entryId?: unknown; mode?: unknown } | null;
		const info = await findSession(id);
		if (!info) return c.json({ error: `Unknown session ${id}` }, 404);

		const manager = SessionManager.open(info.path);
		const requested = typeof body?.entryId === "string" ? body.entryId : manager.getLeafId();
		if (!requested) return c.json({ error: "Session has no entries to fork from" }, 400);

		const entry = manager.getEntry(requested);
		if (!entry) return c.json({ error: `Unknown entry ${requested}` }, 404);

		const entryId = body?.mode === "before" ? entry.parentId : requested;
		if (!entryId) {
			return c.json({ error: "Nothing precedes this message, so a fork would be an empty session" }, 409);
		}

		const path = manager.createBranchedSession(entryId);
		if (!path) return c.json({ error: "Session is not persisted, so it cannot be forked" }, 409);

		// pi only writes a session file once it holds an assistant message, so a
		// branch of nothing but prompts stays in memory and would 404 on reopen.
		if (!existsSync(path)) {
			return c.json({ error: "That branch has no model reply yet, so there is nothing to fork" }, 409);
		}

		const forked = SessionManager.open(path);
		return c.json({ sessionId: forked.getSessionId(), path });
	});

	/** Streams the export back as a download instead of leaving a file on disk. */
	app.get("/:id/export", async (c) => {
		const id = c.req.param("id");
		const format = c.req.query("format") === "jsonl" ? "jsonl" : "html";

		const wrapper = await registry.resolve(id);
		if (!wrapper) return c.json({ error: `Unknown session ${id}` }, 404);
		if (!wrapper.sessionFile) return c.json({ error: "Session is not persisted, so it cannot be exported" }, 409);

		const target = join(tmpdir(), `lares-export-${id}.${format}`);
		try {
			if (format === "jsonl") wrapper.session.exportToJsonl(target);
			else await wrapper.session.exportToHtml(target);

			const raw = await readFile(target, "utf8");
			const body = format === "html" ? repairHtmlExport(raw, wrapper.sessionFile) : raw;
			return c.body(body, 200, {
				"content-type": format === "jsonl" ? "application/x-ndjson" : "text/html; charset=utf-8",
				"content-disposition": `attachment; filename="session-${id}.${format}"`,
			});
		} finally {
			await rm(target, { force: true });
		}
	});

	return app;
}
