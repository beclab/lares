import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AvailableModel, ModelRef } from "@lares/shared";
import { Hono } from "hono";

/** Lazily created because ModelRuntime reads auth and model files from disk. */
export async function createRuntime(agentDir: string): Promise<ModelRuntime> {
	return ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: join(agentDir, "models.json"),
	});
}

function readDefaultModel(agentDir: string): ModelRef | null {
	try {
		const raw = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")) as {
			defaultProvider?: string;
			defaultModel?: string;
		};
		if (raw.defaultProvider && raw.defaultModel) {
			return { provider: raw.defaultProvider, modelId: raw.defaultModel };
		}
	} catch {
		// A missing or malformed settings file simply means "no default yet".
	}
	return null;
}

export function createModelRoutes(agentDir: string): Hono {
	const app = new Hono();
	let runtime: Promise<ModelRuntime> | undefined;

	const getRuntime = () => {
		runtime ??= createRuntime(agentDir);
		return runtime;
	};

	app.get("/", async (c) => {
		const models: AvailableModel[] = (await getRuntime()).getModels().map((model) => ({
			provider: model.provider,
			modelId: model.id,
			name: model.name,
			reasoning: model.reasoning,
			input: [...model.input],
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
		}));
		const error = (await getRuntime()).getError();
		return c.json({
			models,
			defaultModel: readDefaultModel(agentDir),
			...(error ? { error } : {}),
		});
	});

	app.post("/refresh", async (c) => {
		runtime = createRuntime(agentDir);
		const refreshed = await runtime;
		return c.json({ providers: refreshed.getRegisteredProviderIds(), error: refreshed.getError() ?? null });
	});

	/** The raw models.json, for the editor in the settings panel. */
	app.get("/config", (c) => {
		try {
			return c.json({ config: JSON.parse(readFileSync(modelsPath(agentDir), "utf8")) as unknown });
		} catch {
			return c.json({ config: { providers: {} } });
		}
	});

	app.put("/config", async (c) => {
		const body = (await c.req.json().catch(() => null)) as { config?: unknown } | null;
		const config = body?.config;
		if (!config || typeof config !== "object" || !("providers" in config)) {
			return c.json({ error: "config must be an object with a providers key" }, 400);
		}

		writeFileSync(modelsPath(agentDir), `${JSON.stringify(config, null, 2)}\n`, "utf8");

		// The runtime caches the parsed file, so a stale instance would keep
		// serving the models the user just edited away.
		runtime = createRuntime(agentDir);
		const refreshed = await runtime;
		const dropped = Object.keys((config as { providers: Record<string, unknown> }).providers).filter(
			(id) => refreshed.getProvider(id) === undefined,
		);

		return c.json({
			config,
			error: refreshed.getError() ?? null,
			// pi discards a malformed provider without complaining, which otherwise
			// looks like the edit was saved and then ignored.
			dropped,
		});
	});

	return app;
}

function modelsPath(agentDir: string): string {
	return join(agentDir, "models.json");
}
