import { serve } from "@hono/node-server";
import { Hono } from "hono";

export interface CapturedRequest {
	path: string;
	method: string;
	headers: Record<string, string>;
	body: unknown;
}

export interface MockGateway {
	baseUrl: string;
	requests: CapturedRequest[];
	/** Text the fake model replies with on the next completion. */
	setReply(text: string): void;
	/** Force the next request to fail with this status. */
	setStatus(status: number | null): void;
	close(): Promise<void>;
}

function sseChunk(payload: unknown): string {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

type Fetch = Parameters<typeof serve>[0]["fetch"];

/** serve() binds asynchronously, so the port is only known in the callback. */
function listen(fetch: Fetch, port = 0): Promise<{ server: ReturnType<typeof serve>; port: number }> {
	return new Promise((resolve) => {
		const server = serve({ fetch, port, hostname: "127.0.0.1" }, (info) => resolve({ server, port: info.port }));
	});
}

/** Minimal OpenAI-compatible stand-in for the Olares llm-gateway. */
export async function startMockGateway(): Promise<MockGateway> {
	const requests: CapturedRequest[] = [];
	let reply = "ack";
	let forcedStatus: number | null = null;

	const app = new Hono();

	app.use("*", async (c, next) => {
		const headers: Record<string, string> = {};
		c.req.raw.headers.forEach((value, key) => {
			headers[key.toLowerCase()] = value;
		});
		let body: unknown = null;
		if (c.req.method !== "GET") {
			const text = await c.req.raw.clone().text();
			body = text ? JSON.parse(text) : null;
		}
		requests.push({ path: c.req.path, method: c.req.method, headers, body });
		await next();
	});

	app.use("*", async (c, next) => {
		if (forcedStatus === null) return next();
		const status = forcedStatus;
		forcedStatus = null;
		return c.json({ error: { message: "forced failure" } }, status as 401);
	});

	app.get("/v1/models", (c) =>
		c.json({
			object: "list",
			data: [
				{ id: "gpt-5", object: "model", created: 0, owned_by: "openai", qualified_id: "openai/gpt-5" },
				{ id: "claude-opus-4-5", object: "model", created: 0, owned_by: "anthropic" },
			],
		}),
	);

	app.post("/v1/chat/completions", async (c) => {
		const payload = (await c.req.json()) as { stream?: boolean; model?: string };
		const model = payload.model ?? "default";
		const created = Math.floor(Date.now() / 1000);

		if (payload.stream !== true) {
			return c.json({
				id: "cmpl-mock",
				object: "chat.completion",
				created,
				model,
				choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
				usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
			});
		}

		const body = [
			sseChunk({
				id: "cmpl-mock",
				object: "chat.completion.chunk",
				created,
				model,
				choices: [{ index: 0, delta: { role: "assistant", content: reply }, finish_reason: null }],
			}),
			sseChunk({
				id: "cmpl-mock",
				object: "chat.completion.chunk",
				created,
				model,
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
				usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
			}),
			"data: [DONE]\n\n",
		].join("");

		return new Response(body, {
			headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
		});
	});

	const { server, port } = await listen(app.fetch);

	return {
		baseUrl: `http://127.0.0.1:${port}/v1`,
		requests,
		setReply(text) {
			reply = text;
		},
		setStatus(status) {
			forcedStatus = status;
		},
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()));
			}),
	};
}
