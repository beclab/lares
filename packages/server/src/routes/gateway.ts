import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GATEWAY_PROVIDER_ID, type GatewayStatus, type ModelsConfig } from "@lares/shared";
import { Hono } from "hono";
import type { GatewayAuth } from "../gateway/client.ts";
import { authHeaders } from "../gateway/client.ts";
import { fetchGatewayModels, mergeDiscoveredModels } from "../gateway/models.ts";

function readModelsConfig(path: string): ModelsConfig {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as ModelsConfig;
		return parsed.providers ? parsed : { providers: {} };
	} catch {
		return { providers: {} };
	}
}

function writeModelsConfig(path: string, config: ModelsConfig): void {
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	renameSync(tmp, path);
}

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
		let discovered: Awaited<ReturnType<typeof fetchGatewayModels>>;
		try {
			discovered = await fetchGatewayModels(auth, AbortSignal.timeout(10_000));
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
		}

		const path = join(agentDir, "models.json");
		const config = readModelsConfig(path);
		const merged = mergeDiscoveredModels(config, GATEWAY_PROVIDER_ID, discovered);
		if (merged.added.length > 0) writeModelsConfig(path, merged.config);

		return c.json({
			discovered: discovered.map((model) => model.id),
			added: merged.added,
			kept: merged.kept,
		});
	});

	return app;
}
