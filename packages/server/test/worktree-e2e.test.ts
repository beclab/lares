import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { SessionListResponse, WorktreeInfo, WorktreeListResponse } from "@lares/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectEvents, type Harness, startHarness } from "./support/harness.ts";
import { type MockGateway, startMockGateway } from "./support/mock-gateway.ts";

let gateway: MockGateway;
let harness: Harness;
let repo: string;
/** What /api/config reports, which is what every relative path is measured from. */
let root: string;

beforeAll(async () => {
	gateway = await startMockGateway();
	harness = await startHarness(gateway.baseUrl);
	root = realpathSync(harness.workspace);

	repo = join(harness.workspace, "repo");
	mkdirSync(repo, { recursive: true });
	const run = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
	run(["init", "-q", "-b", "main"]);
	run(["config", "user.email", "test@example.com"]);
	run(["config", "user.name", "Test"]);
	writeFileSync(join(repo, "README.md"), "# repo\n");
	run(["add", "README.md"]);
	run(["commit", "-qm", "first"]);
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
		throw new Error(`${path} failed (${response.status}): ${body.error}`);
	}
	return (await response.json()) as T;
}

describe("worktrees on the real server", () => {
	let created: WorktreeInfo;

	it("creates a checkout the file routes can reach", async () => {
		created = await json<WorktreeInfo>("/api/worktrees", {
			method: "POST",
			body: JSON.stringify({ cwd: "repo", branch: "feature/a" }),
		});

		const rel = relative(root, created.path);
		const listing = await json<{ entries: { name: string }[] }>(`/api/files/list?path=${encodeURIComponent(rel)}`);

		expect(listing.entries.map((entry) => entry.name)).toContain("README.md");
	});

	it("runs a session inside the checkout and lists it under that cwd", async () => {
		gateway.setReply("done");

		const start = await json<{ sessionId: string }>("/api/agent/new", {
			method: "POST",
			body: JSON.stringify({ cwd: created.path }),
		});

		const events = collectEvents(harness.baseUrl, start.sessionId, (event) => event.type === "agent_end");
		await json(`/api/agent/${start.sessionId}`, {
			method: "POST",
			body: JSON.stringify({ type: "prompt", message: "hello" }),
		});
		await events;

		const { sessions } = await json<SessionListResponse>("/api/sessions");
		const session = sessions.find((entry) => entry.id === start.sessionId);
		expect(session?.cwd).toBe(created.path);
	});

	it("reports the checkout from inside it", async () => {
		const rel = relative(root, created.path);
		const body = await json<WorktreeListResponse>(`/api/worktrees?cwd=${encodeURIComponent(rel)}`);

		expect(body.current).toBe(created.path);
		expect(body.mainRoot).toBe(join(root, "repo"));
		expect(body.worktrees.map((entry) => entry.branch)).toEqual(["main", "feature/a"]);
	});

	it("refuses a session outside the workspace", async () => {
		const response = await fetch(`${harness.baseUrl}/api/agent/new`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ cwd: "/etc" }),
		});

		expect(response.status).toBe(403);
	});
});
