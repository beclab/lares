import { GATEWAY_SHIM_PREFIX } from "@lares/shared";
import { Hono } from "hono";
import { authFailureHint, authHeaders, type GatewayAuth } from "./client.ts";

/** Hop-by-hop and identity headers that must not be relayed upstream. */
const DROPPED_REQUEST_HEADERS = new Set([
	"authorization",
	"connection",
	"content-length",
	"host",
	"keep-alive",
	"transfer-encoding",
	"upgrade",
	"x-olares-app-id",
]);

const DROPPED_RESPONSE_HEADERS = new Set(["connection", "content-encoding", "content-length", "transfer-encoding"]);

function forwardedRequestHeaders(source: Headers, auth: GatewayAuth): Headers {
	const headers = new Headers();
	source.forEach((value, key) => {
		if (!DROPPED_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
	});
	for (const [key, value] of Object.entries(authHeaders(auth))) headers.set(key, value);
	return headers;
}

function forwardedResponseHeaders(source: Headers): Headers {
	const headers = new Headers();
	source.forEach((value, key) => {
		if (!DROPPED_RESPONSE_HEADERS.has(key.toLowerCase())) headers.set(key, value);
	});
	return headers;
}

/**
 * Reverse proxy that lets pi reach the llm-gateway.
 *
 * pi speaks to the gateway through the official OpenAI SDK, which always sends
 * an Authorization header and requires a non-empty key. The gateway's lazy app
 * auth requires the opposite: no Authorization at all, just X-Olares-App-ID.
 * This shim reconciles the two by dropping whatever pi sent and attaching the
 * credentials lares was configured with.
 */
export function createGatewayShim(auth: GatewayAuth, prefix: string = GATEWAY_SHIM_PREFIX): Hono {
	const app = new Hono();

	app.all(`${prefix}/*`, async (c) => {
		const incoming = new URL(c.req.url);
		// Hono keeps the full path on mounted routes, so strip the mount point
		// rather than trusting a relative path here.
		const suffix = incoming.pathname.slice(prefix.length).replace(/^\/+/, "");
		const target = `${auth.baseUrl}/${suffix}${incoming.search}`;

		const method = c.req.method;
		const body = method === "GET" || method === "HEAD" ? undefined : await c.req.arrayBuffer();

		let upstream: Response;
		try {
			upstream = await fetch(target, {
				method,
				headers: forwardedRequestHeaders(c.req.raw.headers, auth),
				body,
				signal: c.req.raw.signal,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return c.json(
				{
					error: {
						type: "upstream_unreachable",
						message: `Cannot reach the LLM gateway at ${auth.baseUrl}: ${message}`,
					},
				},
				502,
			);
		}

		if (upstream.status === 401 || upstream.status === 403) {
			const text = await upstream.text();
			return c.json(
				{
					error: {
						type: "gateway_auth_failed",
						message: `${authFailureHint(auth)} Gateway said: ${text}`,
					},
				},
				upstream.status,
			);
		}

		return new Response(upstream.body, {
			status: upstream.status,
			headers: forwardedResponseHeaders(upstream.headers),
		});
	});

	return app;
}
