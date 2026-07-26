import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelsConfig } from "@lares/shared";
import { describe, expect, it } from "vitest";
import { bootstrapPiConfig, mergeDefaultModel, mergeGatewayProvider, shimBaseUrl } from "../src/config/bootstrap.ts";

function tempAgentDir(): string {
	return mkdtempSync(join(tmpdir(), "lares-bootstrap-"));
}

describe("mergeGatewayProvider", () => {
	it("adds the provider when models.json is empty", () => {
		const { config, changed } = mergeGatewayProvider({ providers: {} }, 30141);
		expect(changed).toBe(true);
		expect(config.providers.olares?.baseUrl).toBe(shimBaseUrl(30141));
		expect(config.providers.olares?.api).toBe("openai-completions");
		expect(config.providers.olares?.models).toEqual([{ id: "default", name: "Gateway default" }]);
	});

	it("refreshes the base url when the port changes but keeps tuned models", () => {
		const existing: ModelsConfig = {
			providers: {
				olares: {
					baseUrl: shimBaseUrl(1234),
					api: "openai-completions",
					apiKey: "olares",
					models: [{ id: "gpt-5", contextWindow: 400000 }],
				},
			},
		};
		const { config, changed } = mergeGatewayProvider(existing, 30141);
		expect(changed).toBe(true);
		expect(config.providers.olares?.baseUrl).toBe(shimBaseUrl(30141));
		expect(config.providers.olares?.models).toEqual([{ id: "gpt-5", contextWindow: 400000 }]);
	});

	it("leaves other providers alone and reports no change when already correct", () => {
		const existing: ModelsConfig = {
			providers: {
				anthropic: { apiKey: "ANTHROPIC_API_KEY" },
				olares: {
					baseUrl: shimBaseUrl(30141),
					api: "openai-completions",
					apiKey: "olares",
					models: [{ id: "default", name: "Gateway default" }],
				},
			},
		};
		const { config, changed } = mergeGatewayProvider(existing, 30141);
		expect(changed).toBe(false);
		expect(config.providers.anthropic).toEqual({ apiKey: "ANTHROPIC_API_KEY" });
	});
});

describe("mergeDefaultModel", () => {
	it("seeds the gateway provider when nothing is configured", () => {
		const { settings, changed } = mergeDefaultModel({}, null);
		expect(changed).toBe(true);
		expect(settings).toMatchObject({ defaultProvider: "olares", defaultModel: "default" });
	});

	it("splits PI_DEFAULT_MODEL on the first slash", () => {
		const { settings } = mergeDefaultModel({}, "openai/gpt-5-codex");
		expect(settings).toMatchObject({ defaultProvider: "openai", defaultModel: "gpt-5-codex" });
	});

	it("treats a bare id as a gateway model", () => {
		const { settings } = mergeDefaultModel({}, "claude-opus-4-5");
		expect(settings).toMatchObject({ defaultProvider: "olares", defaultModel: "claude-opus-4-5" });
	});

	it("never overrides a model the user already picked", () => {
		const existing = { defaultProvider: "anthropic", defaultModel: "claude-opus-4-5", theme: "dark" };
		const { settings, changed } = mergeDefaultModel(existing, "openai/gpt-5");
		expect(changed).toBe(false);
		expect(settings).toBe(existing);
	});
});

describe("bootstrapPiConfig", () => {
	it("writes both files on a fresh agent dir", () => {
		const agentDir = tempAgentDir();
		const report = bootstrapPiConfig({ agentDir, port: 30141, defaultModel: null });

		expect(report.modelsConfigChanged).toBe(true);
		expect(report.settingsChanged).toBe(true);
		expect(report.warnings).toEqual([]);

		const models = JSON.parse(readFileSync(join(agentDir, "models.json"), "utf8")) as ModelsConfig;
		expect(models.providers.olares?.baseUrl).toBe(shimBaseUrl(30141));
	});

	it("is idempotent across restarts", () => {
		const agentDir = tempAgentDir();
		bootstrapPiConfig({ agentDir, port: 30141, defaultModel: null });
		const second = bootstrapPiConfig({ agentDir, port: 30141, defaultModel: null });

		expect(second.modelsConfigChanged).toBe(false);
		expect(second.settingsChanged).toBe(false);
	});

	it("refuses to clobber a malformed models.json", () => {
		const agentDir = tempAgentDir();
		const path = join(agentDir, "models.json");
		writeFileSync(path, "{ not json", "utf8");

		const report = bootstrapPiConfig({ agentDir, port: 30141, defaultModel: null });

		expect(report.modelsConfigChanged).toBe(false);
		expect(report.warnings.join(" ")).toContain("models.json is unreadable");
		expect(readFileSync(path, "utf8")).toBe("{ not json");
	});
});
