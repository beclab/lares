import { mkdirSync } from "node:fs";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { serve } from "@hono/node-server";
import { createApp, gatewayAuthFromEnv } from "./app.ts";
import { bootstrapPiConfig } from "./config/bootstrap.ts";
import { loadEnv } from "./env.ts";
import { describeAuth, type GatewayAuth } from "./gateway/client.ts";
import { syncGatewayModels } from "./gateway/models.ts";
import { SessionRegistry } from "./pi-bridge/session-registry.ts";

/**
 * Pull the endpoint's model list into models.json before anything reads it.
 *
 * The app is configured entirely by env, so on a fresh install models.json
 * only carries the `default` alias and PI_DEFAULT_MODEL cannot resolve to a
 * real model. Discovery also doubles as a reachability check: a wrong URL or
 * a blocked network path shows up here instead of at the first prompt.
 */
async function syncModelsOnStartup(auth: GatewayAuth, agentDir: string): Promise<void> {
	try {
		const result = await syncGatewayModels(auth, agentDir, AbortSignal.timeout(10_000));
		console.log(`[lares] gateway offers ${result.discovered.length} models: ${result.discovered.join(", ") || "none"}`);
		if (result.added.length > 0) console.log(`[lares] added to models.json: ${result.added.join(", ")}`);
	} catch (err) {
		console.warn(`[lares] could not read models from the gateway: ${err instanceof Error ? err.message : err}`);
	}
}

async function main(): Promise<void> {
	const env = loadEnv();

	// pi's session components resolve theme colours eagerly, including on code
	// paths that never render a TUI.
	initTheme();

	mkdirSync(env.workspace, { recursive: true });
	const report = bootstrapPiConfig({ agentDir: env.agentDir, port: env.port, defaultModel: env.defaultModel });
	for (const warning of report.warnings) console.warn(`[lares] ${warning}`);
	if (report.modelsConfigChanged) console.log("[lares] wrote gateway provider into models.json");
	if (report.settingsChanged) console.log("[lares] seeded default model into settings.json");

	const auth = gatewayAuthFromEnv(env);
	console.log(`[lares] gateway ${env.gatewayUrl} using ${describeAuth(auth)}`);
	await syncModelsOnStartup(auth, env.agentDir);

	const registry = new SessionRegistry({ agentDir: env.agentDir });
	registry.start();

	const app = createApp(env, registry);
	const server = serve({ fetch: app.fetch, port: env.port, hostname: env.host }, (info) => {
		console.log(`[lares] listening on http://${env.host}:${info.port}`);
		console.log(`[lares] agent dir ${env.agentDir}`);
		console.log(`[lares] workspace ${env.workspace}`);
	});

	const shutdown = () => {
		registry.disposeAll();
		server.close(() => process.exit(0));
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

main().catch((err) => {
	console.error("[lares] failed to start:", err);
	process.exit(1);
});
