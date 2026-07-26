/**
 * Shapes of pi's `models.json`. Only the subset lares reads or writes is
 * modelled; unknown keys are preserved verbatim when the file is rewritten.
 */

export interface ModelCost {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface ModelDefinition {
	id: string;
	name?: string;
	api?: string;
	reasoning?: boolean;
	input?: string[];
	contextWindow?: number;
	maxTokens?: number;
	cost?: ModelCost;
	headers?: Record<string, string>;
}

export interface ProviderDefinition {
	baseUrl?: string;
	api?: string;
	apiKey?: string;
	headers?: Record<string, string>;
	authHeader?: boolean;
	models?: ModelDefinition[];
	modelOverrides?: Record<string, unknown>;
}

export interface ModelsConfig {
	providers: Record<string, ProviderDefinition>;
}

/** pi model defaults, applied when the gateway reports no capability metadata. */
export const MODEL_DEFAULTS = {
	contextWindow: 128000,
	maxTokens: 16384,
	reasoning: false,
	input: ["text"] as string[],
} as const;
