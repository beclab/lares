import type { GatewayStatus } from "@lares/shared";
import { Hono } from "hono";
import type { GatewayAuth } from "../gateway/client.ts";
import { authHeaders } from "../gateway/client.ts";
import { syncGatewayModels } from "../gateway/models.ts";

export function createGatewayRoutes(auth: GatewayAuth, agentDir: string): Hono {
	const app = new Hono();

	app.get("/status", async (c) => {
		const status: GatewayStatus = {
			baseUrl: auth.baseUrl,
			appId: auth.appId,
			usesBearer: Boolean(auth.apiKey),
			reachable: false,
		};
		try {
			const response = await fetch(`${auth.baseUrl}/models`, {
				headers: { accept: "application/json", ...authHeaders(auth) },
				signal: AbortSignal.timeout(5000),
			});
			status.reachable = response.ok;
			if (!response.ok) status.error = `Gateway returned ${response.status}`;
		} catch (err) {
			status.error = err instanceof Error ? err.message : String(err);
		}
		return c.json(status);
	});

	app.post("/sync-models", async (c) => {
		try {
			return c.json(await syncGatewayModels(auth, agentDir, AbortSignal.timeout(10_000)));
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
		}
	});

	return app;
}
