import { randomUUID } from "node:crypto";
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AuthFlowEvent, ProviderAuthInfo } from "@lares/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

/**
 * A login in progress.
 *
 * pi drives login by asking questions through callbacks, but a browser can only
 * answer over a second request. Each pending question is parked here under an
 * id until the client posts an answer back.
 */
interface PendingLogin {
	providerId: string;
	answers: Map<string, (value: string) => void>;
	abort: AbortController;
}

const logins = new Map<string, PendingLogin>();

function describePrompt(promptId: string, prompt: AuthPrompt): AuthFlowEvent {
	return {
		type: "prompt",
		promptId,
		kind: prompt.type,
		message: prompt.message,
		...(prompt.type === "select" ? { options: prompt.options.map(({ id, label }) => ({ id, label })) } : {}),
	};
}

function describeEvent(event: AuthEvent): AuthFlowEvent | null {
	switch (event.type) {
		case "info":
			return { type: "info", message: event.message };
		case "auth_url":
			return { type: "auth_url", url: event.url, ...(event.instructions ? { instructions: event.instructions } : {}) };
		case "device_code":
			return { type: "device_code", userCode: event.userCode, verificationUri: event.verificationUri };
		case "progress":
			return { type: "progress", message: event.message };
		default:
			return null;
	}
}

export function createAuthRoutes(getRuntime: () => Promise<ModelRuntime>): Hono {
	const app = new Hono();

	app.get("/providers", async (c) => {
		const runtime = await getRuntime();
		const providers: ProviderAuthInfo[] = runtime.getProviders().map((provider) => {
			const status = runtime.getProviderAuthStatus(provider.id);
			return {
				id: provider.id,
				name: provider.name,
				configured: status.configured,
				source: status.source ?? null,
				supportsApiKey: provider.auth.apiKey?.login !== undefined,
				supportsOAuth: provider.auth.oauth !== undefined,
				usingOAuth: runtime.isUsingOAuth(provider.id),
				modelCount: provider.getModels().length,
			};
		});
		return c.json({ providers });
	});

	/** Keys are write-only: a stored credential is never echoed back. */
	app.post("/api-key/:provider", async (c) => {
		const providerId = c.req.param("provider");
		const body = (await c.req.json().catch(() => null)) as { apiKey?: unknown } | null;
		const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
		if (!apiKey) return c.json({ error: "apiKey is required" }, 400);

		const runtime = await getRuntime();
		await runtime.login(providerId, "api_key", {
			prompt: async () => apiKey,
			notify: () => {},
		});
		return c.json({ configured: runtime.getProviderAuthStatus(providerId).configured });
	});

	app.delete("/:provider", async (c) => {
		const providerId = c.req.param("provider");
		const runtime = await getRuntime();
		await runtime.logout(providerId);
		return c.json({ configured: runtime.getProviderAuthStatus(providerId).configured });
	});

	/**
	 * Runs an OAuth login and reports each step as it happens. The stream stays
	 * open for the whole flow because that is the only way to hand the browser a
	 * device code or a callback URL as pi produces it.
	 */
	app.get("/oauth/:provider", async (c) => {
		const providerId = c.req.param("provider");
		const loginId = randomUUID();
		const runtime = await getRuntime();

		return streamSSE(c, async (sse) => {
			const pending: PendingLogin = { providerId, answers: new Map(), abort: new AbortController() };
			logins.set(loginId, pending);

			const send = (event: AuthFlowEvent) => sse.writeSSE({ data: JSON.stringify(event) });
			await send({ type: "info", message: `Starting ${providerId} login` });
			await sse.writeSSE({ data: JSON.stringify({ type: "info", message: loginId }), event: "login-id" });

			try {
				await runtime.login(providerId, "oauth", {
					signal: pending.abort.signal,
					notify: (event) => {
						const mapped = describeEvent(event);
						if (mapped) void send(mapped);
					},
					prompt: async (prompt) => {
						const promptId = randomUUID();
						await send(describePrompt(promptId, prompt));
						return new Promise<string>((resolve, reject) => {
							pending.answers.set(promptId, resolve);
							prompt.signal?.addEventListener("abort", () => reject(new Error("Prompt cancelled")));
						});
					},
				});
				await send({ type: "done" });
			} catch (err) {
				await send({ type: "error", message: err instanceof Error ? err.message : String(err) });
			} finally {
				logins.delete(loginId);
			}
		});
	});

	app.post("/oauth/:provider/answer", async (c) => {
		const body = (await c.req.json().catch(() => null)) as { loginId?: unknown; promptId?: unknown; value?: unknown };
		const loginId = typeof body?.loginId === "string" ? body.loginId : "";
		const promptId = typeof body?.promptId === "string" ? body.promptId : "";
		const value = typeof body?.value === "string" ? body.value : "";

		const resolve = logins.get(loginId)?.answers.get(promptId);
		if (!resolve) return c.json({ error: "That login step is no longer waiting for an answer" }, 404);

		logins.get(loginId)?.answers.delete(promptId);
		resolve(value);
		return c.json({ accepted: true });
	});

	app.post("/oauth/:provider/cancel", async (c) => {
		const body = (await c.req.json().catch(() => null)) as { loginId?: unknown };
		const loginId = typeof body?.loginId === "string" ? body.loginId : "";
		const pending = logins.get(loginId);
		if (!pending) return c.json({ error: "No such login" }, 404);

		pending.abort.abort();
		logins.delete(loginId);
		return c.json({ cancelled: true });
	});

	return app;
}
