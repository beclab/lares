import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { serve } from "@hono/node-server";
import type { LaresEvent } from "@lares/shared";
import { createApp } from "../../src/app.ts";
import { bootstrapPiConfig } from "../../src/config/bootstrap.ts";
import { loadEnv } from "../../src/env.ts";
import { SessionRegistry } from "../../src/pi-bridge/session-registry.ts";

export interface Harness {
	baseUrl: string;
	agentDir: string;
	workspace: string;
	registry: SessionRegistry;
	close(): Promise<void>;
}

async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.on("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const address = probe.address();
			if (!address || typeof address === "string") {
				reject(new Error("Could not reserve a port"));
				return;
			}
			const { port } = address;
			probe.close(() => resolve(port));
		});
	});
}

/**
 * Boot the real server against a temporary pi home.
 *
 * The port is reserved up front because pi reaches the shim through the URL
 * baked into models.json, so config and listener have to agree.
 */
export async function startHarness(gatewayUrl: string): Promise<Harness> {
	const root = mkdtempSync(join(tmpdir(), "lares-e2e-"));
	const agentDir = join(root, "agent");
	const workspace = join(root, "workspace");
	const port = await freePort();

	process.env.PORT = String(port);
	process.env.HOST = "127.0.0.1";
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.LARES_WORKSPACE = workspace;
	process.env.LLM_GATEWAY_URL = gatewayUrl;
	process.env.OLARES_APP_ID = "com.olares.lares";
	delete process.env.LARES_GATEWAY_API_KEY;
	delete process.env.LARES_WEB_ROOT;
	delete process.env.PI_DEFAULT_MODEL;

	const env = loadEnv();
	initTheme();
	bootstrapPiConfig({ agentDir: env.agentDir, port: env.port, defaultModel: env.defaultModel });

	const { mkdirSync } = await import("node:fs");
	mkdirSync(workspace, { recursive: true });

	const registry = new SessionRegistry({ agentDir: env.agentDir });
	const app = createApp(env, registry);
	const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
		const instance = serve({ fetch: app.fetch, port: env.port, hostname: "127.0.0.1" }, () => resolve(instance));
	});

	return {
		baseUrl: `http://127.0.0.1:${env.port}`,
		agentDir,
		workspace,
		registry,
		close: async () => {
			registry.disposeAll();
			await new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()));
			});
		},
	};
}

/**
 * Read a session's SSE stream until `predicate` matches, then stop.
 * Rejects on timeout so a stalled agent fails loudly instead of hanging.
 */
export async function collectEvents(
	baseUrl: string,
	sessionId: string,
	predicate: (event: LaresEvent, all: LaresEvent[]) => boolean,
	timeoutMs = 20_000,
): Promise<LaresEvent[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const events: LaresEvent[] = [];

	try {
		const response = await fetch(`${baseUrl}/api/agent/${sessionId}/events`, {
			headers: { accept: "text/event-stream" },
			signal: controller.signal,
		});
		if (!response.body) throw new Error("Event stream has no body");

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			let boundary = buffer.indexOf("\n\n");
			while (boundary !== -1) {
				const frame = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				boundary = buffer.indexOf("\n\n");

				const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
				const payload = dataLine?.slice(5).trim();
				if (!payload) continue;

				const event = JSON.parse(payload) as LaresEvent;
				events.push(event);
				if (predicate(event, events)) {
					controller.abort();
					return events;
				}
			}
		}
		return events;
	} catch (err) {
		if (controller.signal.aborted && events.length > 0) return events;
		throw err;
	} finally {
		clearTimeout(timer);
	}
}
