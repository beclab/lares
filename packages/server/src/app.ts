import { existsSync } from "node:fs";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { GATEWAY_SHIM_PREFIX } from "@lares/shared";
import { Hono } from "hono";
import type { LaresEnv } from "./env.ts";
import { workspaceRoot } from "./files/paths.ts";
import { describeAuth, type GatewayAuth } from "./gateway/client.ts";
import { createGatewayShim } from "./gateway/shim.ts";
import type { SessionRegistry } from "./pi-bridge/session-registry.ts";
import { createAgentRoutes } from "./routes/agent.ts";
import { createAuthRoutes } from "./routes/auth.ts";
import { createFileRoutes } from "./routes/files.ts";
import { createGatewayRoutes } from "./routes/gateway.ts";
import { createGitRoutes } from "./routes/git.ts";
import { createModelRoutes, createRuntime } from "./routes/models.ts";
import { createPluginRoutes } from "./routes/plugins.ts";
import { createSessionRoutes } from "./routes/sessions.ts";
import { createSettingsRoutes } from "./routes/settings.ts";
import { createSkillRoutes } from "./routes/skills.ts";
import { createWorktreeRoutes } from "./routes/worktrees.ts";
import { mountStatic } from "./static.ts";

export function gatewayAuthFromEnv(env: LaresEnv): GatewayAuth {
	return { baseUrl: env.gatewayUrl, appId: env.olaresAppId, apiKey: env.gatewayApiKey };
}

export function createApp(env: LaresEnv, registry: SessionRegistry): Hono {
	const app = new Hono();
	const auth = gatewayAuthFromEnv(env);

	// One runtime for the auth routes: it owns the credential store, so two
	// instances would each hold their own view of auth.json.
	let runtime: Promise<ModelRuntime> | undefined;
	const authRuntime = (): Promise<ModelRuntime> => {
		runtime ??= createRuntime(env.agentDir);
		return runtime;
	};

	app.get("/api/health", (c) => c.json({ ok: true }));

	app.get("/api/config", (c) =>
		c.json({
			// The resolved root, because every path the API hands back is a real
			// path and the client makes them workspace-relative by string prefix.
			workspace: workspaceRoot(env.workspace),
			agentDir: env.agentDir,
			gateway: { baseUrl: auth.baseUrl, auth: describeAuth(auth) },
		}),
	);

	app.route("/api/agent", createAgentRoutes(registry, env.workspace));
	app.route("/api/sessions", createSessionRoutes(registry));
	app.route("/api/models", createModelRoutes(env.agentDir));
	app.route("/api/files", createFileRoutes(env.workspace));
	app.route("/api/git", createGitRoutes(env.workspace));
	app.route("/api/settings", createSettingsRoutes(env.agentDir, env.workspace));
	app.route("/api/auth", createAuthRoutes(authRuntime));
	app.route("/api/skills", createSkillRoutes(env.agentDir, env.workspace));
	app.route("/api/plugins", createPluginRoutes(env.agentDir, env.workspace));
	app.route("/api/worktrees", createWorktreeRoutes(env.workspace));
	app.route("/api/gateway", createGatewayRoutes(auth, env.agentDir));
	app.route("/", createGatewayShim(auth, GATEWAY_SHIM_PREFIX));

	if (env.webRoot && existsSync(env.webRoot)) mountStatic(app, env.webRoot);

	return app;
}
