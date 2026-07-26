import type {
	AvailableModel,
	EditableSettings,
	PackageInfo,
	ProviderAuthInfo,
	SkillInfo,
	ThinkingLevel,
} from "@lares/shared";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api } from "../lib/api";

/**
 * Everything the configuration panel reads and writes.
 *
 * The panel spans four unrelated files on disk, so the store loads each section
 * on demand and keeps them apart; opening the skills tab should not re-read
 * models.json.
 */
export const useSettingsStore = defineStore("settings", () => {
	const settings = ref<EditableSettings | null>(null);
	const settingsPath = ref<string | null>(null);
	const modelsPath = ref<string | null>(null);
	const providers = ref<ProviderAuthInfo[]>([]);
	const skills = ref<SkillInfo[]>([]);
	const skillDiagnostics = ref<string[]>([]);
	const packages = ref<PackageInfo[]>([]);
	const extensions = ref<{ name: string; path: string }[]>([]);
	const pluginErrors = ref<string[]>([]);
	const modelsConfig = ref<string>("");
	const models = ref<AvailableModel[]>([]);
	const busy = ref(false);
	const error = ref<string | null>(null);

	const configuredProviders = computed(() => providers.value.filter((provider) => provider.configured));

	async function guard<T>(work: () => Promise<T>): Promise<T | null> {
		busy.value = true;
		error.value = null;
		try {
			return await work();
		} catch (err) {
			error.value = err instanceof Error ? err.message : String(err);
			return null;
		} finally {
			busy.value = false;
		}
	}

	async function loadSettings(): Promise<void> {
		await guard(async () => {
			const response = await api.settings();
			settings.value = response.settings;
			settingsPath.value = response.settingsPath;
			modelsPath.value = response.modelsPath;
		});
	}

	async function patch(changes: Partial<EditableSettings>): Promise<void> {
		await guard(async () => {
			const response = await api.saveSettings(changes);
			settings.value = response.settings;
		});
	}

	async function setThinkingLevel(level: ThinkingLevel): Promise<void> {
		await patch({ defaultThinkingLevel: level });
	}

	async function loadModels(refresh = false): Promise<void> {
		await guard(async () => {
			// pi parses models.json once and keeps it, so a plain read would show
			// the same list the server started with.
			if (refresh) await api.refreshModels();
			const [available, raw] = await Promise.all([api.models(), api.modelsConfig()]);
			models.value = available.models;
			modelsConfig.value = `${JSON.stringify(raw.config, null, 2)}\n`;
		});
	}

	/** Returns true when the edit was accepted, so the editor can stop nagging. */
	async function saveModelsConfig(text: string): Promise<boolean> {
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (err) {
			error.value = `models.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`;
			return false;
		}

		const result = await guard(async () => {
			const response = await api.saveModelsConfig(parsed);
			modelsConfig.value = `${JSON.stringify(response.config, null, 2)}\n`;
			const available = await api.models();
			models.value = available.models;
			return response;
		});

		if (!result) return false;

		// The file was written either way, so this is a warning about what pi
		// will actually use, not a failure to save.
		if (result.dropped.length > 0) {
			error.value = `Saved, but pi ignored these providers because they are incomplete: ${result.dropped.join(", ")}`;
		} else if (result.error) {
			error.value = result.error;
		}
		return true;
	}

	async function loadProviders(): Promise<void> {
		await guard(async () => {
			providers.value = (await api.authProviders()).providers;
		});
	}

	async function setApiKey(provider: string, apiKey: string): Promise<void> {
		await guard(async () => {
			await api.setApiKey(provider, apiKey);
			await loadProviders();
		});
	}

	async function signOut(provider: string): Promise<void> {
		await guard(async () => {
			await api.signOut(provider);
			await loadProviders();
		});
	}

	async function loadSkills(): Promise<void> {
		await guard(async () => {
			const response = await api.skills();
			skills.value = response.skills;
			skillDiagnostics.value = response.diagnostics;
		});
	}

	async function setSkillModelInvocation(name: string, disabled: boolean): Promise<void> {
		await guard(async () => {
			const response = await api.setSkillModelInvocation(name, disabled);
			skills.value = response.skills;
			skillDiagnostics.value = response.diagnostics;
		});
	}

	function applyPlugins(response: { packages: PackageInfo[]; extensions: typeof extensions.value; errors: string[] }) {
		packages.value = response.packages;
		extensions.value = response.extensions;
		pluginErrors.value = response.errors;
	}

	async function loadPlugins(): Promise<void> {
		await guard(async () => {
			applyPlugins(await api.plugins());
		});
	}

	async function pluginAction(
		action: "install" | "remove" | "update" | "enable" | "disable",
		source: string,
	): Promise<void> {
		await guard(async () => {
			applyPlugins(await api.pluginAction(action, source));
		});
	}

	return {
		settings,
		settingsPath,
		modelsPath,
		providers,
		configuredProviders,
		skills,
		skillDiagnostics,
		packages,
		extensions,
		pluginErrors,
		modelsConfig,
		models,
		busy,
		error,
		loadSettings,
		patch,
		setThinkingLevel,
		loadModels,
		saveModelsConfig,
		loadProviders,
		setApiKey,
		signOut,
		loadSkills,
		setSkillModelInvocation,
		loadPlugins,
		pluginAction,
	};
});
