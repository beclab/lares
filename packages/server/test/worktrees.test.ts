import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorktreeInfo, WorktreeListResponse } from "@lares/shared";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { parseWorktreeList, WORKTREE_DIR, worktreeDirName } from "../src/files/worktree.ts";
import { createWorktreeRoutes } from "../src/routes/worktrees.ts";

function initRepo(path: string): void {
	mkdirSync(path, { recursive: true });
	const run = (args: string[]) => execFileSync("git", ["-C", path, ...args], { stdio: "pipe" });
	run(["init", "-q", "-b", "main"]);
	run(["config", "user.email", "test@example.com"]);
	run(["config", "user.name", "Test"]);
	writeFileSync(join(path, "file.txt"), "one\n");
	run(["add", "file.txt"]);
	run(["commit", "-qm", "first"]);
}

describe("branch name flattening", () => {
	it("keeps a plain name", () => {
		expect(worktreeDirName("feature")).toBe("feature");
	});

	it("flattens a slash so one branch is one folder", () => {
		expect(worktreeDirName("feature/login")).toBe("feature-login");
	});

	it("collapses runs of unusable characters", () => {
		expect(worktreeDirName("fix: the  thing")).toBe("fix-the-thing");
	});

	it("refuses a name that would escape or vanish", () => {
		expect(() => worktreeDirName("..")).toThrow();
		expect(() => worktreeDirName("///")).toThrow();
	});
});

describe("worktree list parsing", () => {
	const always = () => true;

	it("marks the first entry as the main checkout", () => {
		const output =
			"worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /wt/a\nHEAD def\nbranch refs/heads/a\n";
		expect(parseWorktreeList(output, always)).toEqual<WorktreeInfo[]>([
			{ path: "/repo", branch: "main", isMain: true, locked: false },
			{ path: "/wt/a", branch: "a", isMain: false, locked: false },
		]);
	});

	it("reports a detached checkout with no branch", () => {
		const parsed = parseWorktreeList("worktree /repo\nHEAD abc\ndetached\n", always);
		expect(parsed[0]?.branch).toBeNull();
	});

	it("carries the locked flag through", () => {
		const parsed = parseWorktreeList("worktree /repo\nHEAD abc\nbranch refs/heads/main\nlocked reason\n", always);
		expect(parsed[0]?.locked).toBe(true);
	});

	it("drops a prunable entry, which is a checkout git has already lost", () => {
		const output =
			"worktree /repo\nbranch refs/heads/main\n\nworktree /gone\nprunable gitdir file points to non-existent\n";
		expect(parseWorktreeList(output, always).map((entry) => entry.path)).toEqual(["/repo"]);
	});

	it("drops an entry whose directory is missing", () => {
		const output = "worktree /repo\nbranch refs/heads/main\n\nworktree /gone\nbranch refs/heads/x\n";
		expect(parseWorktreeList(output, (path) => path === "/repo").map((entry) => entry.path)).toEqual(["/repo"]);
	});
});

describe("worktree routes", () => {
	let workspace: string;
	let app: Hono;

	beforeEach(() => {
		workspace = mkdtempSync(join(tmpdir(), "lares-wt-"));
		app = new Hono();
		app.route("/api/worktrees", createWorktreeRoutes(workspace));
	});

	async function call<T>(init: RequestInit & { path: string }): Promise<{ status: number; body: T }> {
		const { path, ...rest } = init;
		const response = await app.request(`http://localhost${path}`, {
			...rest,
			headers: { "content-type": "application/json", ...(rest.headers ?? {}) },
		});
		return { status: response.status, body: (await response.json()) as T };
	}

	it("says a plain directory is not a repository", async () => {
		const { body } = await call<WorktreeListResponse>({ path: "/api/worktrees" });
		expect(body.isRepository).toBe(false);
		expect(body.worktrees).toEqual([]);
	});

	it("creates a checkout for a new branch inside the workspace", async () => {
		initRepo(join(workspace, "repo"));

		const created = await call<WorktreeInfo>({
			path: "/api/worktrees",
			method: "POST",
			body: JSON.stringify({ cwd: "repo", branch: "feature/login" }),
		});

		expect(created.status).toBe(201);
		expect(created.body.branch).toBe("feature/login");
		expect(created.body.path).toContain(join(WORKTREE_DIR, "repo", "feature-login"));
		expect(existsSync(join(created.body.path, "file.txt"))).toBe(true);

		const list = await call<WorktreeListResponse>({ path: "/api/worktrees?cwd=repo" });
		expect(list.body.worktrees.map((entry) => entry.branch)).toEqual(["main", "feature/login"]);
		expect(list.body.worktrees[0]?.isMain).toBe(true);
	});

	it("checks out a branch that already exists rather than failing", async () => {
		const repo = join(workspace, "repo");
		initRepo(repo);
		execFileSync("git", ["-C", repo, "branch", "existing"], { stdio: "pipe" });

		const created = await call<WorktreeInfo>({
			path: "/api/worktrees",
			method: "POST",
			body: JSON.stringify({ cwd: "repo", branch: "existing" }),
		});

		expect(created.status).toBe(201);
		const head = execFileSync("git", ["-C", created.body.path, "rev-parse", "--abbrev-ref", "HEAD"]).toString().trim();
		expect(head).toBe("existing");
	});

	it("refuses a second checkout at the same path", async () => {
		initRepo(join(workspace, "repo"));
		const body = JSON.stringify({ cwd: "repo", branch: "dup" });

		await call({ path: "/api/worktrees", method: "POST", body });
		const second = await call<{ code: string }>({ path: "/api/worktrees", method: "POST", body });

		expect(second.status).toBe(400);
		expect(second.body.code).toBe("exists");
	});

	it("removes a clean checkout", async () => {
		initRepo(join(workspace, "repo"));
		const created = await call<WorktreeInfo>({
			path: "/api/worktrees",
			method: "POST",
			body: JSON.stringify({ cwd: "repo", branch: "temp" }),
		});

		const removed = await call({
			path: "/api/worktrees",
			method: "DELETE",
			body: JSON.stringify({ path: created.body.path }),
		});

		expect(removed.status).toBe(200);
		expect(existsSync(created.body.path)).toBe(false);
	});

	it("refuses to discard uncommitted work unless asked twice", async () => {
		initRepo(join(workspace, "repo"));
		const created = await call<WorktreeInfo>({
			path: "/api/worktrees",
			method: "POST",
			body: JSON.stringify({ cwd: "repo", branch: "dirty" }),
		});
		writeFileSync(join(created.body.path, "file.txt"), "changed\n");

		const refused = await call<{ code: string }>({
			path: "/api/worktrees",
			method: "DELETE",
			body: JSON.stringify({ path: created.body.path }),
		});
		expect(refused.status).toBe(409);
		expect(refused.body.code).toBe("dirty");

		const forced = await call({
			path: "/api/worktrees",
			method: "DELETE",
			body: JSON.stringify({ path: created.body.path, force: true }),
		});
		expect(forced.status).toBe(200);
		expect(existsSync(created.body.path)).toBe(false);
	});

	it("refuses to remove the main checkout", async () => {
		const repo = join(workspace, "repo");
		initRepo(repo);

		const { status, body } = await call<{ code: string }>({
			path: "/api/worktrees",
			method: "DELETE",
			body: JSON.stringify({ path: "repo" }),
		});

		expect(status).toBe(400);
		expect(body.code).toBe("main");
	});

	it("refuses a path outside the workspace", async () => {
		const { status } = await call({
			path: "/api/worktrees",
			method: "DELETE",
			body: JSON.stringify({ path: "../elsewhere" }),
		});
		expect(status).toBe(403);
	});

	it("keeps checkouts out of git status when the repository is the workspace", async () => {
		initRepo(workspace);

		await call({
			path: "/api/worktrees",
			method: "POST",
			body: JSON.stringify({ cwd: ".", branch: "nested" }),
		});

		const exclude = readFileSync(join(workspace, ".git", "info", "exclude"), "utf8");
		expect(exclude).toContain(`/${WORKTREE_DIR}/`);

		const status = execFileSync("git", ["-C", workspace, "status", "--porcelain"]).toString();
		expect(status).toBe("");
	});
});
