import { mkdirSync } from "node:fs";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { serve } from "@hono/node-server";
import { createApp, gatewayAuthFromEnv } from "./app.ts";
import { bootstrapPiConfig } from "./config/bootstrap.ts";
import { loadEnv } from "./env.ts";
import { describeAuth } from "./gateway/client.ts";
import { SessionRegistry } from "./pi-bridge/session-registry.ts";

function main(): void {
	const env = loadEnv();

	// pi's session components resolve theme colours eagerly, including on code
	// paths that never render a TUI.
	initTheme();

	mkdirSync(env.workspace, { recursive: true });
	const report = bootstrapPiConfig({ agentDir: env.agentDir, port: env.port, defaultModel: env.defaultModel });
	for (const warning of report.warnings) console.warn(`[lares] ${warning}`);
	if (report.modelsConfigChanged) console.log("[lares] wrote gateway provider into models.json");
	if (report.settingsChanged) console.log("[lares] seeded default model into settings.json");

	const registry = new SessionRegistry({ agentDir: env.agentDir });
	registry.start();

	const app = createApp(env, registry);
	const server = serve({ fetch: app.fetch, port: env.port, hostname: env.host }, (info) => {
		console.log(`[lares] listening on http://${env.host}:${info.port}`);
		console.log(`[lares] agent dir ${env.agentDir}`);
		console.log(`[lares] workspace ${env.workspace}`);
		console.log(`[lares] gateway ${env.gatewayUrl} using ${describeAuth(gatewayAuthFromEnv(env))}`);
	});

	const shutdown = () => {
		registry.disposeAll();
		server.close(() => process.exit(0));
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

main();
