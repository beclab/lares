import { MODEL_DEFAULTS, type ModelsConfig } from "@lares/shared";
import { describe, expect, it } from "vitest";
import { mergeDiscoveredModels, parseModelList } from "../src/gateway/models.ts";

describe("parseModelList", () => {
	it("prefers the qualified id so the gateway can route unambiguously", () => {
		const models = parseModelList({
			data: [{ id: "gpt-5", owned_by: "openai", qualified_id: "openai/gpt-5" }],
		});
		expect(models).toEqual([{ id: "openai/gpt-5", name: "gpt-5 (openai)" }]);
	});

	it("falls back to the bare id", () => {
		expect(parseModelList({ data: [{ id: "local-model" }] })).toEqual([{ id: "local-model", name: "local-model" }]);
	});

	it("skips entries without a usable id", () => {
		expect(parseModelList({ data: [{ owned_by: "openai" }, null, "nope"] })).toEqual([]);
	});

	it("tolerates a payload that is not a list", () => {
		expect(parseModelList({})).toEqual([]);
		expect(parseModelList(null)).toEqual([]);
	});
});

describe("mergeDiscoveredModels", () => {
	it("adds unknown models with pi's default capabilities", () => {
		const { config, added, kept } = mergeDiscoveredModels({ providers: { olares: {} } }, "olares", [
			{ id: "openai/gpt-5", name: "gpt-5 (openai)" },
		]);

		expect(added).toEqual(["openai/gpt-5"]);
		expect(kept).toEqual([]);
		expect(config.providers.olares?.models?.[0]).toMatchObject({
			id: "openai/gpt-5",
			contextWindow: MODEL_DEFAULTS.contextWindow,
			maxTokens: MODEL_DEFAULTS.maxTokens,
			reasoning: false,
		});
	});

	it("keeps hand-tuned capabilities for models it already knows", () => {
		const existing: ModelsConfig = {
			providers: { olares: { models: [{ id: "openai/gpt-5", contextWindow: 400000, reasoning: true }] } },
		};
		const { config, added, kept } = mergeDiscoveredModels(existing, "olares", [
			{ id: "openai/gpt-5", name: "gpt-5 (openai)" },
		]);

		expect(added).toEqual([]);
		expect(kept).toEqual(["openai/gpt-5"]);
		expect(config).toBe(existing);
	});
});
