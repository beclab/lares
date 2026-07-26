import type { SessionSummary, SessionTreeResponse } from "@lares/shared";
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

async function json<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${harness.baseUrl}${path}`, {
		...init,
		headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
	});
	const payload = (await response.json()) as T & { error?: string };
	if (!response.ok) throw new Error(`${path} failed: ${payload.error ?? response.status}`);
	return payload;
}

/** Runs one prompt to completion so the session has a transcript to work with. */
async function converse(sessionId: string, message: string, reply: string): Promise<void> {
	gateway.setReply(reply);
	const events = collectEvents(harness.baseUrl, sessionId, (event) => event.type === "agent_end");
	await json(`/api/agent/${sessionId}`, { method: "POST", body: JSON.stringify({ type: "prompt", message }) });
	await events;
}

async function newSession(): Promise<string> {
	const created = await json<{ sessionId: string }>("/api/agent/new", {
		method: "POST",
		body: JSON.stringify({ cwd: harness.workspace, command: { type: "ensure_session" } }),
	});
	return created.sessionId;
}

describe("session management", () => {
	it("exposes the transcript as a tree with fork points", async () => {
		const id = await newSession();
		await converse(id, "first question", "first answer");
		await converse(id, "second question", "second answer");

		const tree = await json<SessionTreeResponse>(`/api/sessions/${id}/tree`);

		expect(tree.leafId).toBeTruthy();
		expect(tree.forkPoints.map((point) => point.text)).toEqual(["first question", "second question"]);

		// The live path runs root to leaf, so every fork point sits on it.
		const flat: SessionTreeResponse["roots"] = [];
		const walk = (nodes: SessionTreeResponse["roots"]): void => {
			for (const node of nodes) {
				flat.push(node);
				walk(node.children);
			}
		};
		walk(tree.roots);
		expect(flat.every((node) => node.onCurrentPath)).toBe(true);
		expect(flat.some((node) => node.role === "assistant" && node.preview === "first answer")).toBe(true);
	});

	it("renames a session without disturbing the live copy", async () => {
		const id = await newSession();
		await converse(id, "name me", "sure");

		await json(`/api/sessions/${id}/name`, { method: "POST", body: JSON.stringify({ name: "renamed" }) });

		const list = await json<{ sessions: SessionSummary[] }>("/api/sessions");
		expect(list.sessions.find((session) => session.id === id)?.name).toBe("renamed");
	});

	it("restarts from a message, leaving the original intact", async () => {
		const id = await newSession();
		await converse(id, "question one", "answer one");
		await converse(id, "question two", "answer two");

		const tree = await json<SessionTreeResponse>(`/api/sessions/${id}/tree`);
		const secondUser = tree.forkPoints[1];
		expect(secondUser).toBeDefined();

		const forked = await json<{ sessionId: string }>(`/api/sessions/${id}/fork`, {
			method: "POST",
			body: JSON.stringify({ entryId: secondUser?.entryId, mode: "before" }),
		});
		expect(forked.sessionId).not.toBe(id);

		// "before" drops the chosen prompt so it can be rewritten.
		const forkedTree = await json<SessionTreeResponse>(`/api/sessions/${forked.sessionId}/tree`);
		expect(forkedTree.forkPoints.map((point) => point.text)).toEqual(["question one"]);

		const originalTree = await json<SessionTreeResponse>(`/api/sessions/${id}/tree`);
		expect(originalTree.forkPoints).toHaveLength(2);
	});

	it("copies the whole session when forking at the leaf", async () => {
		const id = await newSession();
		await converse(id, "question one", "answer one");
		await converse(id, "question two", "answer two");

		const forked = await json<{ sessionId: string }>(`/api/sessions/${id}/fork`, {
			method: "POST",
			body: JSON.stringify({}),
		});

		const forkedTree = await json<SessionTreeResponse>(`/api/sessions/${forked.sessionId}/tree`);
		expect(forkedTree.forkPoints.map((point) => point.text)).toEqual(["question one", "question two"]);
	});

	it("refuses to fork a branch pi has not written yet", async () => {
		const id = await newSession();
		await converse(id, "only question", "only answer");

		const tree = await json<SessionTreeResponse>(`/api/sessions/${id}/tree`);
		const response = await fetch(`${harness.baseUrl}/api/sessions/${id}/fork`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ entryId: tree.forkPoints[0]?.entryId, mode: "before" }),
		});

		expect(response.status).toBe(409);
	});

	it("keeps the abandoned branch after navigating back", async () => {
		const id = await newSession();
		await converse(id, "original question", "original answer");

		const before = await json<SessionTreeResponse>(`/api/sessions/${id}/tree`);
		const target = before.forkPoints[0]?.entryId as string;

		await json(`/api/agent/${id}`, {
			method: "POST",
			body: JSON.stringify({ type: "navigate_tree", targetId: target }),
		});
		await converse(id, "different question", "different answer");

		const after = await json<SessionTreeResponse>(`/api/sessions/${id}/tree`);
		const previews: string[] = [];
		const walk = (nodes: SessionTreeResponse["roots"]): void => {
			for (const node of nodes) {
				previews.push(node.preview);
				walk(node.children);
			}
		};
		walk(after.roots);

		expect(previews).toContain("original answer");
		expect(previews).toContain("different question");
	});

	it("exports a session as HTML and as JSONL", async () => {
		const id = await newSession();
		await converse(id, "export me", "exported");

		const html = await fetch(`${harness.baseUrl}/api/sessions/${id}/export?format=html`);
		expect(html.headers.get("content-type")).toContain("text/html");

		// The viewer embeds the transcript as base64 to sidestep HTML escaping.
		const body = await html.text();
		const payload = /<script id="session-data"[^>]*>([A-Za-z0-9+/=]+)<\/script>/.exec(body)?.[1];
		expect(payload, "session payload is missing from the export").toBeTruthy();
		expect(Buffer.from(payload as string, "base64").toString("utf8")).toContain("exported");

		const jsonl = await fetch(`${harness.baseUrl}/api/sessions/${id}/export?format=jsonl`);
		const lines = (await jsonl.text()).trim().split("\n");
		expect(lines.length).toBeGreaterThan(0);
		expect(() => lines.map((line) => JSON.parse(line))).not.toThrow();
	});

	it("deletes a session and drops it from the list", async () => {
		const id = await newSession();
		await converse(id, "delete me", "ok");

		await json(`/api/sessions/${id}`, { method: "DELETE" });

		const list = await json<{ sessions: SessionSummary[] }>("/api/sessions");
		expect(list.sessions.some((session) => session.id === id)).toBe(false);
	});
});
