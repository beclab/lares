import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	GATEWAY_PLACEHOLDER_API_KEY,
	GATEWAY_PROVIDER_ID,
	GATEWAY_SHIM_PREFIX,
	type ModelsConfig,
	type ProviderDefinition,
} from "@lares/shared";

export interface BootstrapInput {
	agentDir: string;
	port: number;
	/** `provider/id`; when omitted the gateway's own `default` alias is used. */
	defaultModel: string | null;
}

export interface BootstrapReport {
	modelsConfigChanged: boolean;
	settingsChanged: boolean;
	warnings: string[];
}

interface Settings {
	defaultProvider?: string;
	defaultModel?: string;
	[key: string]: unknown;
}

export function shimBaseUrl(port: number): string {
	return `http://127.0.0.1:${port}${GATEWAY_SHIM_PREFIX}`;
}

/**
 * Merge the gateway provider into an existing models.json.
 *
 * The base URL, api and apiKey are infrastructure that lares owns, so they are
 * always refreshed. The model list is user territory: it is seeded once and
 * then left alone, because the capability fields are hand-tuned in the UI.
 */
export function mergeGatewayProvider(config: ModelsConfig, port: number): { config: ModelsConfig; changed: boolean } {
	const existing = config.providers[GATEWAY_PROVIDER_ID];
	const desired: ProviderDefinition = {
		...existing,
		baseUrl: shimBaseUrl(port),
		api: "openai-completions",
		apiKey: GATEWAY_PLACEHOLDER_API_KEY,
		models: existing?.models?.length ? existing.models : [{ id: "default", name: "Gateway default" }],
	};

	const changed = JSON.stringify(existing ?? null) !== JSON.stringify(desired);
	if (!changed) return { config, changed: false };

	return {
		config: { ...config, providers: { ...config.providers, [GATEWAY_PROVIDER_ID]: desired } },
		changed: true,
	};
}

/**
 * Seed the default model. Existing values win, so a model picked in the UI
 * survives restarts even when PI_DEFAULT_MODEL still points elsewhere.
 */
export function mergeDefaultModel(
	settings: Settings,
	defaultModel: string | null,
): { settings: Settings; changed: boolean } {
	if (settings.defaultProvider && settings.defaultModel) {
		return { settings, changed: false };
	}

	let provider = GATEWAY_PROVIDER_ID;
	let modelId = "default";
	if (defaultModel) {
		const slash = defaultModel.indexOf("/");
		if (slash > 0) {
			provider = defaultModel.slice(0, slash);
			modelId = defaultModel.slice(slash + 1);
		} else {
			modelId = defaultModel;
		}
	}

	return {
		settings: { ...settings, defaultProvider: provider, defaultModel: modelId },
		changed: true,
	};
}

function readJsonFile<T>(path: string): { value: T | null; error: string | null } {
	try {
		return { value: JSON.parse(readFileSync(path, "utf8")) as T, error: null };
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return { value: null, error: null };
		return { value: null, error: err instanceof Error ? err.message : String(err) };
	}
}

function writeJsonAtomic(path: string, value: unknown): void {
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	renameSync(tmp, path);
}

export function bootstrapPiConfig(input: BootstrapInput): BootstrapReport {
	const warnings: string[] = [];
	mkdirSync(input.agentDir, { recursive: true });

	const modelsPath = join(input.agentDir, "models.json");
	const settingsPath = join(input.agentDir, "settings.json");

	let modelsConfigChanged = false;
	const models = readJsonFile<ModelsConfig>(modelsPath);
	if (models.error) {
		warnings.push(`models.json is unreadable, leaving it untouched: ${models.error}`);
	} else {
		const current: ModelsConfig = models.value ?? { providers: {} };
		if (!current.providers || typeof current.providers !== "object") current.providers = {};
		const merged = mergeGatewayProvider(current, input.port);
		if (merged.changed) {
			writeJsonAtomic(modelsPath, merged.config);
			modelsConfigChanged = true;
		}
	}

	let settingsChanged = false;
	const settings = readJsonFile<Settings>(settingsPath);
	if (settings.error) {
		warnings.push(`settings.json is unreadable, leaving it untouched: ${settings.error}`);
	} else {
		const merged = mergeDefaultModel(settings.value ?? {}, input.defaultModel);
		if (merged.changed) {
			writeJsonAtomic(settingsPath, merged.settings);
			settingsChanged = true;
		}
	}

	return { modelsConfigChanged, settingsChanged, warnings };
}
