import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { type EditableSettings, THINKING_LEVELS, type ThinkingLevel } from "@lares/shared";
import { Hono } from "hono";

function read(manager: SettingsManager): EditableSettings {
	return {
		defaultProvider: manager.getDefaultProvider() ?? null,
		defaultModel: manager.getDefaultModel() ?? null,
		defaultThinkingLevel: (manager.getDefaultThinkingLevel() as EditableSettings["defaultThinkingLevel"]) ?? null,
		theme: manager.getTheme() ?? null,
		autoCompaction: manager.getCompactionEnabled(),
		autoRetry: manager.getRetryEnabled(),
		enableSkillCommands: manager.getEnableSkillCommands(),
		enabledModels: manager.getEnabledModels() ?? [],
	};
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return typeof value === "string" && (THINKING_LEVELS as string[]).includes(value);
}

/**
 * Exposes the slice of pi's settings a single-user deployment can usefully
 * change. Everything else stays under pi's own defaults rather than growing a
 * second, divergent configuration surface.
 */
export function createSettingsRoutes(agentDir: string, workspace: string): Hono {
	const app = new Hono();

	const manager = (): SettingsManager => SettingsManager.create(workspace, agentDir);

	app.get("/", (c) =>
		c.json({
			settings: read(manager()),
			settingsPath: join(agentDir, "settings.json"),
			modelsPath: join(agentDir, "models.json"),
		}),
	);

	app.patch("/", async (c) => {
		const body = (await c.req.json().catch(() => null)) as Partial<EditableSettings> | null;
		if (!body) return c.json({ error: "Body must be a settings object" }, 400);

		const settings = manager();

		if (typeof body.defaultProvider === "string" && typeof body.defaultModel === "string") {
			settings.setDefaultModelAndProvider(body.defaultProvider, body.defaultModel);
		}
		if (body.defaultThinkingLevel !== undefined && body.defaultThinkingLevel !== null) {
			if (!isThinkingLevel(body.defaultThinkingLevel)) return c.json({ error: "Unknown thinking level" }, 400);
			settings.setDefaultThinkingLevel(body.defaultThinkingLevel);
		}
		if (typeof body.theme === "string") settings.setTheme(body.theme);
		if (typeof body.autoCompaction === "boolean") settings.setCompactionEnabled(body.autoCompaction);
		if (typeof body.autoRetry === "boolean") settings.setRetryEnabled(body.autoRetry);
		if (typeof body.enableSkillCommands === "boolean") settings.setEnableSkillCommands(body.enableSkillCommands);
		if (Array.isArray(body.enabledModels)) {
			const patterns = body.enabledModels.filter((entry): entry is string => typeof entry === "string");
			settings.setEnabledModels(patterns.length > 0 ? patterns : undefined);
		}

		// Setters only queue the write, so the response would otherwise race the
		// next read of the same file.
		await settings.flush();
		const errors = settings.drainErrors();
		if (errors.length > 0) {
			return c.json({ error: errors.map((entry) => `${entry.scope}: ${entry.error.message}`).join("; ") }, 500);
		}

		return c.json({ settings: read(manager()) });
	});

	return app;
}
