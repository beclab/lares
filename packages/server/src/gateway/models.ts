import { MODEL_DEFAULTS, type ModelDefinition, type ModelsConfig } from "@lares/shared";
import { authHeaders, type GatewayAuth } from "./client.ts";

interface GatewayModelObject {
	id?: unknown;
	owned_by?: unknown;
	qualified_id?: unknown;
}

export interface DiscoveredModel {
	/** Value sent back to the gateway as `model`; qualified when available. */
	id: string;
	name: string;
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

export function parseModelList(payload: unknown): DiscoveredModel[] {
	if (typeof payload !== "object" || payload === null) return [];
	const data = (payload as { data?: unknown }).data;
	if (!Array.isArray(data)) return [];

	const models: DiscoveredModel[] = [];
	for (const raw of data) {
		if (typeof raw !== "object" || raw === null) continue;
		const entry = raw as GatewayModelObject;
		const bare = asString(entry.id);
		const qualified = asString(entry.qualified_id);
		const id = qualified ?? bare;
		if (!id) continue;
		const owner = asString(entry.owned_by);
		models.push({ id, name: owner && bare ? `${bare} (${owner})` : id });
	}
	return models;
}

export async function fetchGatewayModels(auth: GatewayAuth, signal?: AbortSignal): Promise<DiscoveredModel[]> {
	const response = await fetch(`${auth.baseUrl}/models`, {
		headers: { accept: "application/json", ...authHeaders(auth) },
		signal: signal ?? null,
	});
	if (!response.ok) {
		throw new Error(`Gateway returned ${response.status} for /models: ${await response.text()}`);
	}
	return parseModelList(await response.json());
}

/**
 * Fold discovered models into the gateway provider.
 *
 * Capability fields are not available from `/v1/models`, so new entries get
 * pi's defaults. Entries that already exist keep whatever the user tuned.
 */
export function mergeDiscoveredModels(
	config: ModelsConfig,
	providerId: string,
	discovered: DiscoveredModel[],
): { config: ModelsConfig; added: string[]; kept: string[] } {
	const provider = config.providers[providerId] ?? {};
	const existing = provider.models ?? [];
	const byId = new Map(existing.map((model) => [model.id, model]));

	const added: string[] = [];
	const kept: string[] = [];
	for (const model of discovered) {
		if (byId.has(model.id)) {
			kept.push(model.id);
			continue;
		}
		const definition: ModelDefinition = {
			id: model.id,
			name: model.name,
			reasoning: MODEL_DEFAULTS.reasoning,
			input: [...MODEL_DEFAULTS.input],
			contextWindow: MODEL_DEFAULTS.contextWindow,
			maxTokens: MODEL_DEFAULTS.maxTokens,
		};
		byId.set(model.id, definition);
		added.push(model.id);
	}

	if (added.length === 0) return { config, added, kept };

	return {
		config: {
			...config,
			providers: {
				...config.providers,
				[providerId]: { ...provider, models: [...byId.values()] },
			},
		},
		added,
		kept,
	};
}
