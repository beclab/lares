#!/usr/bin/env node
/**
 * Stand-in for the Olares llm-gateway, for local development and for smoke
 * testing the container without a cluster. It logs the auth headers it sees so
 * you can confirm the shim is rewriting them.
 */
import { createServer } from "node:http";

const port = Number(process.env.MOCK_GATEWAY_PORT ?? 8099);
const reply = process.env.MOCK_GATEWAY_REPLY ?? "Hello from the mock gateway.";

const server = createServer(async (req, res) => {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	const body = Buffer.concat(chunks).toString("utf8");

	console.log(
		`[mock-gateway] ${req.method} ${req.url} authorization=${req.headers.authorization ?? "<none>"} x-olares-app-id=${
			req.headers["x-olares-app-id"] ?? "<none>"
		}`,
	);

	if (req.url?.startsWith("/v1/models")) {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(
			JSON.stringify({
				object: "list",
				data: [
					{ id: "gpt-5", object: "model", created: 0, owned_by: "openai", qualified_id: "openai/gpt-5" },
					{ id: "claude-opus-4-5", object: "model", created: 0, owned_by: "anthropic" },
				],
			}),
		);
		return;
	}

	if (req.url?.startsWith("/v1/chat/completions")) {
		const payload = body ? JSON.parse(body) : {};
		const created = Math.floor(Date.now() / 1000);
		const base = { id: "cmpl-mock", object: "chat.completion.chunk", created, model: payload.model ?? "default" };

		if (payload.stream !== true) {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(
				JSON.stringify({
					...base,
					object: "chat.completion",
					choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
					usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
				}),
			);
			return;
		}

		res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
		res.write(
			`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: reply }, finish_reason: null }] })}\n\n`,
		);
		res.write(
			`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 } })}\n\n`,
		);
		res.write("data: [DONE]\n\n");
		res.end();
		return;
	}

	res.writeHead(404, { "content-type": "application/json" });
	res.end(JSON.stringify({ error: { message: `No mock route for ${req.url}` } }));
});

server.listen(port, "0.0.0.0", () => {
	console.log(`[mock-gateway] listening on http://0.0.0.0:${port}/v1`);
});
