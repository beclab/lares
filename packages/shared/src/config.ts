import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

/** Ordered for the picker; the type comes from pi so the two cannot drift. */
export const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "max"];

/** The slice of pi's settings.json the panel is allowed to change. */
export interface EditableSettings {
	defaultProvider: string | null;
	defaultModel: string | null;
	defaultThinkingLevel: ThinkingLevel | null;
	theme: string | null;
	autoCompaction: boolean;
	autoRetry: boolean;
	enableSkillCommands: boolean;
	/** Glob patterns limiting which models the picker offers. Empty means all. */
	enabledModels: string[];
}

export interface SettingsResponse {
	settings: EditableSettings;
	/** Where the values came from, so the UI can say what is managed by the platform. */
	settingsPath: string;
	modelsPath: string;
}

export interface ProviderAuthInfo {
	id: string;
	name: string;
	configured: boolean;
	/** Where the credential came from: stored, environment, models.json, and so on. */
	source: string | null;
	supportsApiKey: boolean;
	supportsOAuth: boolean;
	usingOAuth: boolean;
	modelCount: number;
}

export interface SkillInfo {
	name: string;
	description: string;
	filePath: string;
	/** True when the model cannot invoke it on its own and it is /skill-only. */
	disableModelInvocation: boolean;
	source: string;
}

export interface SkillsResponse {
	skills: SkillInfo[];
	diagnostics: string[];
}

export interface PackageInfo {
	source: string;
	/** False when the package is installed but every resource is switched off. */
	enabled: boolean;
	scope: "global" | "project";
	extensions: number;
	skills: number;
	prompts: number;
	themes: number;
}

export interface PluginsResponse {
	packages: PackageInfo[];
	extensions: { name: string; path: string }[];
	errors: string[];
}

export interface ToolInfo {
	name: string;
	description: string;
	active: boolean;
	source: string;
}

export interface ToolsResponse {
	tools: ToolInfo[];
}

/** A step in an OAuth login, streamed to the browser over SSE. */
export type AuthFlowEvent =
	| { type: "info"; message: string }
	| { type: "auth_url"; url: string; instructions?: string }
	| { type: "device_code"; userCode: string; verificationUri: string }
	| { type: "progress"; message: string }
	| { type: "prompt"; promptId: string; kind: string; message: string; options?: { id: string; label: string }[] }
	| { type: "done" }
	| { type: "error"; message: string };
