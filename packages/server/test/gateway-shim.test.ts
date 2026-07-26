import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GatewayAuth } from "../src/gateway/client.ts";
import { createGatewayShim } from "../src/gateway/shim.ts";
import { type MockGateway, startMockGateway } from "./support/mock-gateway.ts";

let gateway: MockGateway;

beforeEach(async () => {
	gateway = await startMockGateway();
});

afterEach(async () => {
	await gateway.close();
});

function shimFor(overrides: Partial<GatewayAuth> = {}) {
	const auth: GatewayAuth = { baseUrl: gateway.baseUrl, appId: "com.olares.lares", apiKey: null, ...overrides };
	return createGatewayShim(auth);
}

describe("gateway shim", () => {
	it("replaces the SDK's Authorization header with the app identity", async () => {
		const response = await shimFor().request("/llm/v1/chat/completions", {
			method: "POST",
			headers: { authorization: "Bearer olares", "content-type": "application/json" },
			body: JSON.stringify({ model: "default", messages: [] }),
		});

		expect(response.status).toBe(200);
		const captured = gateway.requests.at(-1);
		expect(captured?.path).toBe("/v1/chat/completions");
		expect(captured?.headers.authorization).toBeUndefined();
		expect(captured?.headers["x-olares-app-id"]).toBe("com.olares.lares");
	});

	it("sends a bearer token instead of the app id when a user key is configured", async () => {
		const response = await shimFor({ apiKey: "sk-user" }).request("/llm/v1/chat/completions", {
			method: "POST",
			headers: { authorization: "Bearer olares" },
			body: JSON.stringify({ model: "default", messages: [] }),
		});

		expect(response.status).toBe(200);
		const captured = gateway.requests.at(-1);
		expect(captured?.headers.authorization).toBe("Bearer sk-user");
		expect(captured?.headers["x-olares-app-id"]).toBeUndefined();
	});

	it("refuses to relay a client-supplied app id", async () => {
		await shimFor().request("/llm/v1/chat/completions", {
			method: "POST",
			headers: { "x-olares-app-id": "com.attacker.app" },
			body: JSON.stringify({ model: "default", messages: [] }),
		});

		expect(gateway.requests.at(-1)?.headers["x-olares-app-id"]).toBe("com.olares.lares");
	});

	it("forwards the query string", async () => {
		await shimFor().request("/llm/v1/models?limit=1");
		expect(gateway.requests.at(-1)?.path).toBe("/v1/models");
	});

	it("turns an auth rejection into an actionable message", async () => {
		gateway.setStatus(401);
		const response = await shimFor().request("/llm/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({ model: "default", messages: [] }),
		});

		expect(response.status).toBe(401);
		const payload = (await response.json()) as { error: { type: string; message: string } };
		expect(payload.error.type).toBe("gateway_auth_failed");
		expect(payload.error.message).toContain("com.olares.lares");
	});

	it("reports an unreachable gateway as a bad gateway", async () => {
		const shim = createGatewayShim({ baseUrl: "http://127.0.0.1:1/v1", appId: "app", apiKey: null });
		const response = await shim.request("/llm/v1/models");

		expect(response.status).toBe(502);
		const payload = (await response.json()) as { error: { type: string } };
		expect(payload.error.type).toBe("upstream_unreachable");
	});
});
