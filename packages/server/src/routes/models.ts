import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AvailableModel, ModelRef } from "@lares/shared";
import { Hono } from "hono";

/** Lazily created because ModelRuntime reads auth and model files from disk. */
async function createRuntime(agentDir: string): Promise<ModelRuntime> {
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

	return app;
}
