import { existsSync, statSync } from "node:fs";
import type { LaresEvent } from "@lares/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SessionRegistry } from "../pi-bridge/session-registry.ts";
import { CommandParseError, parseCommand } from "./command-parser.ts";

const HEARTBEAT_MS = 30_000;

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export function createAgentRoutes(registry: SessionRegistry): Hono {
	const app = new Hono();

	app.post("/new", async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ success: false, error: "Request body must be JSON" }, 400);
		}

		const record = body as Record<string, unknown>;
		const cwd = typeof record.cwd === "string" ? record.cwd : "";
		if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) {
			return c.json({ success: false, error: `Working directory does not exist: ${cwd}` }, 400);
		}

		const toolNames = Array.isArray(record.toolNames)
			? record.toolNames.filter((name): name is string => typeof name === "string")
			: undefined;

		try {
			const command = parseCommand(record.command ?? { type: "ensure_session" });
			const wrapper = await registry.create(cwd, toolNames);
			const data = await wrapper.send(command);
			return c.json({ success: true, sessionId: wrapper.id, data });
		} catch (err) {
			const status = err instanceof CommandParseError ? 400 : 500;
			return c.json({ success: false, error: errorMessage(err) }, status);
		}
	});

	app.get("/running/events", (c) =>
		streamSSE(c, async (stream) => {
			const send = async (ids: string[]) => {
				await stream.writeSSE({ data: JSON.stringify({ type: "running", runningSessionIds: ids }) });
			};
			await send(registry.runningIds());

			let resolveClosed: () => void = () => {};
			const closed = new Promise<void>((resolve) => {
				resolveClosed = resolve;
			});
			const unsubscribe = registry.onRunningChange((ids) => {
				void send(ids).catch(resolveClosed);
			});
			const heartbeat = setInterval(() => {
				void stream.writeSSE({ data: "", event: "ping" }).catch(resolveClosed);
			}, HEARTBEAT_MS);

			stream.onAbort(resolveClosed);
			await closed;
			clearInterval(heartbeat);
			unsubscribe();
		}),
	);

	app.get("/:id/events", async (c) => {
		const id = c.req.param("id");
		const wrapper = await registry.resolve(id);
		if (!wrapper) return c.json({ error: `Unknown session ${id}` }, 404);

		return streamSSE(c, async (stream) => {
			let resolveClosed: () => void = () => {};
			const closed = new Promise<void>((resolve) => {
				resolveClosed = resolve;
			});

			const write = (event: LaresEvent) => {
				void stream.writeSSE({ data: JSON.stringify(event) }).catch(resolveClosed);
			};

			write({ type: "connected", sessionId: wrapper.id });
			const unsubscribe = wrapper.subscribe(write);
			const heartbeat = setInterval(() => {
				void stream.writeSSE({ data: "", event: "ping" }).catch(resolveClosed);
			}, HEARTBEAT_MS);

			stream.onAbort(resolveClosed);
			await closed;
			clearInterval(heartbeat);
			unsubscribe();
		});
	});

	app.get("/:id", async (c) => {
		const id = c.req.param("id");
		const wrapper = await registry.resolve(id);
		if (!wrapper) return c.json({ running: false }, 404);
		return c.json({ running: wrapper.isRunning, state: wrapper.getState() });
	});

	app.post("/:id", async (c) => {
		const id = c.req.param("id");
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ success: false, error: "Request body must be JSON" }, 400);
		}

		try {
			const command = parseCommand(body);
			const wrapper = await registry.resolve(id);
			if (!wrapper) return c.json({ success: false, error: `Unknown session ${id}` }, 404);
			const data = await wrapper.send(command);
			return c.json({ success: true, data });
		} catch (err) {
			const status = err instanceof CommandParseError ? 400 : 500;
			return c.json({ success: false, error: errorMessage(err) }, status);
		}
	});

	return app;
}
