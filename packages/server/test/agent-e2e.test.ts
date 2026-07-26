import type { AssistantMessage, LaresEvent, SessionState } from "@lares/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectEvents, type Harness, startHarness } from "./support/harness.ts";
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

async function postJson<T>(path: string, body: unknown): Promise<T> {
	const response = await fetch(`${harness.baseUrl}${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	const payload = (await response.json()) as T & { error?: string };
	if (!response.ok) throw new Error(`${path} failed: ${payload.error ?? response.status}`);
	return payload;
}

describe("agent over the gateway shim", () => {
	it("completes a prompt end to end", async () => {
		gateway.setReply("hello from the fake gateway");

		const created = await postJson<{ sessionId: string }>("/api/agent/new", {
			cwd: harness.workspace,
			command: { type: "ensure_session" },
		});
		expect(created.sessionId).toBeTruthy();

		const events = collectEvents(harness.baseUrl, created.sessionId, (event) => event.type === "agent_end");
		await postJson(`/api/agent/${created.sessionId}`, { type: "prompt", message: "say hi" });
		const received = await events;

		expect(received[0]).toEqual({ type: "connected", sessionId: created.sessionId });

		const assistant = lastAssistantMessage(received);
		const text = assistant.content.find((block) => block.type === "text");
		expect(text?.type === "text" ? text.text : "").toContain("hello from the fake gateway");
	});

	it("reaches the gateway as the configured Olares app, never as a bearer client", () => {
		const completion = gateway.requests.filter((request) => request.path === "/v1/chat/completions").at(-1);
		expect(completion).toBeDefined();
		expect(completion?.headers.authorization).toBeUndefined();
		expect(completion?.headers["x-olares-app-id"]).toBe("com.olares.lares");
	});

	it("reports the finished session as idle", async () => {
		const sessions = (await (await fetch(`${harness.baseUrl}/api/sessions`)).json()) as {
			sessions: Array<{ id: string }>;
			runningSessionIds: string[];
		};
		expect(sessions.sessions.length).toBeGreaterThan(0);
		expect(sessions.runningSessionIds).toEqual([]);

		const id = sessions.sessions[0]?.id as string;
		const state = await postJson<{ data: SessionState }>(`/api/agent/${id}`, { type: "get_state" });
		expect(state.data.isStreaming).toBe(false);
		expect(state.data.model).toEqual({ provider: "olares", modelId: "default" });
	});

	it("rejects a malformed command before it reaches pi", async () => {
		const sessions = (await (await fetch(`${harness.baseUrl}/api/sessions`)).json()) as {
			sessions: Array<{ id: string }>;
		};
		const id = sessions.sessions[0]?.id as string;

		const response = await fetch(`${harness.baseUrl}/api/agent/${id}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ type: "prompt" }),
		});

		expect(response.status).toBe(400);
		expect(((await response.json()) as { error: string }).error).toContain("message");
	});
});

function lastAssistantMessage(events: LaresEvent[]): AssistantMessage {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (!event) continue;
		if ((event.type === "message_end" || event.type === "message_update") && event.message.role === "assistant") {
			return event.message;
		}
	}
	throw new Error(`No assistant message in ${events.map((event) => event.type).join(", ")}`);
}
