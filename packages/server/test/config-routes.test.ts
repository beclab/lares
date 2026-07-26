import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EditableSettings, SettingsResponse, SkillsResponse } from "@lares/shared";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { createModelRoutes } from "../src/routes/models.ts";
import { createSettingsRoutes } from "../src/routes/settings.ts";
import { createSkillRoutes, toggleModelInvocation } from "../src/routes/skills.ts";

let agentDir: string;
let workspace: string;
let app: Hono;

beforeAll(() => {
	const root = mkdtempSync(join(tmpdir(), "lares-config-"));
	agentDir = join(root, "agent");
	workspace = join(root, "workspace");
	mkdirSync(join(agentDir, "skills", "greeter"), { recursive: true });
	mkdirSync(workspace, { recursive: true });

	writeFileSync(
		join(agentDir, "skills", "greeter", "SKILL.md"),
		["---", "name: greeter", "description: Says hello", "---", "", "Say hello."].join("\n"),
	);

	app = new Hono();
	app.route("/api/settings", createSettingsRoutes(agentDir, workspace));
	app.route("/api/skills", createSkillRoutes(agentDir, workspace));
	app.route("/api/models", createModelRoutes(agentDir));
});

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
	const response = await app.request(`http://localhost${path}`, {
		...init,
		headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
	});
	return { status: response.status, body: (await response.json()) as T };
}

describe("settings", () => {
	it("reports the current settings and where they live", async () => {
		const { body } = await call<SettingsResponse>("/api/settings");
		expect(body.settingsPath).toBe(join(agentDir, "settings.json"));
		expect(body.settings.autoCompaction).toBe(true);
	});

	it("writes changes through to settings.json", async () => {
		const { body } = await call<{ settings: EditableSettings }>("/api/settings", {
			method: "PATCH",
			body: JSON.stringify({
				defaultProvider: "olares",
				defaultModel: "default",
				defaultThinkingLevel: "medium",
				autoCompaction: false,
			}),
		});

		expect(body.settings.defaultModel).toBe("default");
		expect(body.settings.autoCompaction).toBe(false);

		const onDisk = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")) as Record<string, unknown>;
		expect(onDisk.defaultProvider).toBe("olares");
		expect(onDisk.defaultThinkingLevel).toBe("medium");
	});

	it("rejects an unknown thinking level", async () => {
		const { status } = await call("/api/settings", {
			method: "PATCH",
			body: JSON.stringify({ defaultThinkingLevel: "turbo" }),
		});
		expect(status).toBe(400);
	});
});

describe("skill front matter", () => {
	it("adds the flag when it is missing", () => {
		const result = toggleModelInvocation("---\nname: a\n---\n\nBody\n", true);
		expect(result).toContain("disable-model-invocation: true");
		expect(result).toContain("Body");
	});

	it("replaces an existing flag rather than duplicating it", () => {
		const source = "---\nname: a\ndisable-model-invocation: true\n---\nBody\n";
		const result = toggleModelInvocation(source, false);

		expect(result).toContain("disable-model-invocation: false");
		expect(result.match(/disable-model-invocation/g)).toHaveLength(1);
	});

	it("leaves the rest of the front matter untouched", () => {
		const source = "---\nname: a\nlicense: MIT\nmetadata:\n  x: 1\n---\nBody\n";
		expect(toggleModelInvocation(source, true)).toContain("metadata:\n  x: 1");
	});

	it("refuses a file with no front matter", () => {
		expect(() => toggleModelInvocation("just text", true)).toThrow();
	});
});

describe("skills route", () => {
	it("lists discovered skills", async () => {
		const { body } = await call<SkillsResponse>("/api/skills");
		expect(body.skills.map((skill) => skill.name)).toContain("greeter");
		expect(body.skills.find((skill) => skill.name === "greeter")?.disableModelInvocation).toBe(false);
	});

	it("toggles a skill out of the model's reach", async () => {
		const { body } = await call<SkillsResponse>("/api/skills/greeter", {
			method: "PATCH",
			body: JSON.stringify({ disableModelInvocation: true }),
		});
		expect(body.skills.find((skill) => skill.name === "greeter")?.disableModelInvocation).toBe(true);
	});

	it("answers 404 for an unknown skill", async () => {
		const { status } = await call("/api/skills/nope", {
			method: "PATCH",
			body: JSON.stringify({ disableModelInvocation: true }),
		});
		expect(status).toBe(404);
	});
});

describe("models.json editing", () => {
	it("round-trips a provider through the config route", async () => {
		const config = {
			providers: {
				custom: { baseUrl: "http://example.test/v1", api: "openai-completions", models: [{ id: "tiny" }] },
			},
		};

		const put = await call<{ config: unknown }>("/api/models/config", {
			method: "PUT",
			body: JSON.stringify({ config }),
		});
		expect(put.status).toBe(200);

		const get = await call<{ config: typeof config }>("/api/models/config");
		expect(get.body.config.providers.custom?.baseUrl).toBe("http://example.test/v1");
	});

	it("rejects a payload that is not a provider map", async () => {
		const { status } = await call("/api/models/config", {
			method: "PUT",
			body: JSON.stringify({ config: { nope: true } }),
		});
		expect(status).toBe(400);
	});
});
