import { existsSync } from "node:fs";
import { GATEWAY_SHIM_PREFIX } from "@lares/shared";
import { Hono } from "hono";
import type { LaresEnv } from "./env.ts";
import { describeAuth, type GatewayAuth } from "./gateway/client.ts";
import { createGatewayShim } from "./gateway/shim.ts";
import type { SessionRegistry } from "./pi-bridge/session-registry.ts";
import { createAgentRoutes } from "./routes/agent.ts";
import { createGatewayRoutes } from "./routes/gateway.ts";
import { createModelRoutes } from "./routes/models.ts";
import { createSessionRoutes } from "./routes/sessions.ts";
import { mountStatic } from "./static.ts";

export function gatewayAuthFromEnv(env: LaresEnv): GatewayAuth {
	return { baseUrl: env.gatewayUrl, appId: env.olaresAppId, apiKey: env.gatewayApiKey };
}

export function createApp(env: LaresEnv, registry: SessionRegistry): Hono {
	const app = new Hono();
	const auth = gatewayAuthFromEnv(env);

	app.get("/api/health", (c) => c.json({ ok: true }));

	app.get("/api/config", (c) =>
		c.json({
			workspace: env.workspace,
			agentDir: env.agentDir,
			gateway: { baseUrl: auth.baseUrl, auth: describeAuth(auth) },
		}),
	);

	app.route("/api/agent", createAgentRoutes(registry));
	app.route("/api/sessions", createSessionRoutes(registry));
	app.route("/api/models", createModelRoutes(env.agentDir));
	app.route("/api/gateway", createGatewayRoutes(auth, env.agentDir));
	app.route("/", createGatewayShim(auth, GATEWAY_SHIM_PREFIX));

	if (env.webRoot && existsSync(env.webRoot)) mountStatic(app, env.webRoot);

	return app;
}
