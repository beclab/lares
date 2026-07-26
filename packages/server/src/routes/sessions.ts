import { buildContextEntries, SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionSummary } from "@lares/shared";
import { Hono } from "hono";
import type { SessionRegistry } from "../pi-bridge/session-registry.ts";

function toSummary(info: {
	id: string;
	path: string;
	cwd: string;
	name?: string;
	parentSessionPath?: string;
	created: Date;
	modified: Date;
	messageCount: number;
	firstMessage: string;
}): SessionSummary {
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

export function createSessionRoutes(registry: SessionRegistry): Hono {
	const app = new Hono();

	app.get("/", async (c) => {
		const all = await SessionManager.listAll();
		const sessions = all.map(toSummary).sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
		return c.json({ sessions, runningSessionIds: registry.runningIds() });
	});

	app.get("/:id", async (c) => {
		const id = c.req.param("id");
		const all = await SessionManager.listAll();
		const info = all.find((entry) => entry.id === id);
		if (!info) return c.json({ error: `Unknown session ${id}` }, 404);

		const manager = SessionManager.open(info.path);
		const entries = buildContextEntries(manager.getEntries(), manager.getLeafId());
		return c.json({ session: toSummary(info), entries, leafId: manager.getLeafId() });
	});

	return app;
}
