import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EditableSettings, PluginsResponse, ProviderAuthInfo, SettingsResponse } from "@lares/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, startHarness } from "./support/harness.ts";
import { type MockGateway, startMockGateway } from "./support/mock-gateway.ts";

let gateway: MockGateway;
let harness: Harness;

beforeAll(async () => {
	gateway = await startMockGateway();
	harness = await startHarness(gateway.baseUrl);
});

afterAll(async () => {
	await harness.close();
	await gateway.close();
});

async function json<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${harness.baseUrl}${path}`, {
		...init,
		headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
	});
	if (!response.ok) {
		const body = (await response.json()) as { error?: string };
		throw new Error(`${path} failed: ${body.error}`);
	}
	return (await response.json()) as T;
}

describe("configuration surface on the real server", () => {
	it("reports the bootstrapped defaults", async () => {
		const body = await json<SettingsResponse>("/api/settings");

		// bootstrap writes the gateway provider, so the panel opens on a working
		// default rather than an empty picker.
		expect(body.settings.defaultProvider).toBe("olares");
		expect(body.modelsPath).toBe(join(harness.agentDir, "models.json"));
	});

	it("persists a settings change across a re-read", async () => {
		await json<{ settings: EditableSettings }>("/api/settings", {
			method: "PATCH",
			body: JSON.stringify({ autoRetry: false }),
		});

		const reread = await json<SettingsResponse>("/api/settings");
		expect(reread.settings.autoRetry).toBe(false);

		const onDisk = JSON.parse(readFileSync(join(harness.agentDir, "settings.json"), "utf8")) as {
			retry?: { enabled?: boolean };
		};
		expect(onDisk.retry?.enabled).toBe(false);
	});

	it("lists the gateway provider as configured without a key", async () => {
		const { providers } = await json<{ providers: ProviderAuthInfo[] }>("/api/auth/providers");
		const olares = providers.find((provider) => provider.id === "olares");

		expect(olares?.configured).toBe(true);
		expect(olares?.modelCount).toBeGreaterThan(0);
	});

	it("serves an empty plugin list rather than failing on a fresh install", async () => {
		const body = await json<PluginsResponse>("/api/plugins");
		expect(body.packages).toEqual([]);
		expect(body.errors).toEqual([]);
	});

	it("keeps the model list in step with an edited models.json", async () => {
		const { config } = await json<{ config: { providers: Record<string, unknown> } }>("/api/models/config");
		config.providers.extra = {
			baseUrl: gateway.baseUrl,
			api: "openai-completions",
			apiKey: "unused",
			models: [{ id: "extra-model" }],
		};

		await json("/api/models/config", { method: "PUT", body: JSON.stringify({ config }) });

		const { models } = await json<{ models: { provider: string; modelId: string }[] }>("/api/models");
		expect(models.some((model) => model.provider === "extra" && model.modelId === "extra-model")).toBe(true);
	});

	it("names providers pi threw away instead of pretending the save worked", async () => {
		const { config } = await json<{ config: { providers: Record<string, unknown> } }>("/api/models/config");
		config.providers.broken = { api: "openai-completions", models: [{ id: "nowhere" }] };

		const result = await json<{ dropped: string[] }>("/api/models/config", {
			method: "PUT",
			body: JSON.stringify({ config }),
		});

		// No baseUrl means pi cannot compose the provider, and it says nothing.
		expect(result.dropped).toEqual(["broken"]);
	});
});
