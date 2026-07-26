import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DirListing, FileContent, FileIndexResponse, GitDiffResponse, GitStatusResponse } from "@lares/shared";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { parsePorcelain } from "../src/files/git.ts";
import { score, search } from "../src/files/index-builder.ts";
import { PathDenied, resolveInWorkspace } from "../src/files/paths.ts";
import { createFileRoutes } from "../src/routes/files.ts";
import { createGitRoutes } from "../src/routes/git.ts";

let workspace: string;
let outside: string;
let app: Hono;

beforeAll(() => {
	const root = mkdtempSync(join(tmpdir(), "lares-files-"));
	workspace = join(root, "workspace");
	outside = join(root, "outside");
	mkdirSync(workspace);
	mkdirSync(outside);

	mkdirSync(join(workspace, "src"));
	mkdirSync(join(workspace, "node_modules"));
	writeFileSync(join(workspace, "src", "main.ts"), "export const answer = 42;\n");
	writeFileSync(join(workspace, "src", "helper.ts"), "export const help = true;\n");
	writeFileSync(join(workspace, "README.md"), "# Title\n\nBody.\n");
	writeFileSync(join(workspace, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
	writeFileSync(join(workspace, "blob.bin"), Buffer.from([0x01, 0x00, 0x02, 0x00]));
	writeFileSync(join(workspace, "node_modules", "junk.js"), "noise");
	writeFileSync(join(outside, "secret.txt"), "do not read me");
	symlinkSync(join(outside, "secret.txt"), join(workspace, "escape.txt"));

	app = new Hono();
	app.route("/api/files", createFileRoutes(workspace));
	app.route("/api/git", createGitRoutes(workspace));
});

async function get<T>(path: string): Promise<{ status: number; body: T }> {
	const response = await app.request(`http://localhost${path}`);
	return { status: response.status, body: (await response.json()) as T };
}

describe("workspace path guard", () => {
	it("resolves paths relative to the workspace", () => {
		expect(resolveInWorkspace(workspace, "src/main.ts")).toContain("main.ts");
		expect(resolveInWorkspace(workspace, undefined)).toBe(resolveInWorkspace(workspace, "."));
	});

	it("refuses to climb out with ..", () => {
		expect(() => resolveInWorkspace(workspace, "../outside/secret.txt")).toThrow(PathDenied);
	});

	it("refuses an absolute path outside the workspace", () => {
		expect(() => resolveInWorkspace(workspace, join(outside, "secret.txt"))).toThrow(PathDenied);
	});

	it("refuses a symlink that points outside the workspace", () => {
		expect(() => resolveInWorkspace(workspace, "escape.txt")).toThrow(PathDenied);
	});
});

describe("file routes", () => {
	it("lists a directory with directories first and noise hidden", async () => {
		const { body } = await get<DirListing>("/api/files/list");
		const names = body.entries.map((entry) => entry.name);

		expect(names).not.toContain("node_modules");
		expect(names[0]).toBe("src");
		expect(names).toContain("README.md");
		expect(body.parent).toBeNull();
	});

	it("reports the parent of a nested directory", async () => {
		const { body } = await get<DirListing>("/api/files/list?path=src");
		expect(body.parent).toBe(".");
		expect(body.entries.map((entry) => entry.name)).toEqual(["helper.ts", "main.ts"]);
	});

	it("reads a text file with its language", async () => {
		const { body } = await get<FileContent>("/api/files/read?path=src/main.ts");
		expect(body.language).toBe("typescript");
		expect(body.previewKind).toBe("text");
		expect(body.content).toContain("answer = 42");
	});

	it("classifies markdown and images without reading them as text", async () => {
		const markdown = await get<FileContent>("/api/files/read?path=README.md");
		expect(markdown.body.previewKind).toBe("markdown");

		const image = await get<{ error: string }>("/api/files/read?path=logo.png");
		expect(image.status).toBe(415);
	});

	it("refuses to send a binary file as text", async () => {
		const { status } = await get<{ error: string }>("/api/files/read?path=blob.bin");
		expect(status).toBe(413);
	});

	it("answers 403 for a path outside the workspace", async () => {
		const { status } = await get<{ error: string }>("/api/files/read?path=../outside/secret.txt");
		expect(status).toBe(403);
	});

	it("serves raw bytes with the right content type", async () => {
		const response = await app.request(`http://localhost/api/files/raw?path=logo.png`);
		expect(response.headers.get("content-type")).toBe("image/png");
		expect(new Uint8Array(await response.arrayBuffer())[1]).toBe(0x50);
	});
});

describe("file index", () => {
	it("ranks an exact filename above a substring match", () => {
		expect(score("src/main.ts", "main.ts")).toBeGreaterThan(score("src/domain.ts", "main.ts"));
	});

	it("falls back to subsequence matching", () => {
		expect(score("src/main.ts", "smt")).toBeGreaterThan(0);
		expect(score("src/main.ts", "zzz")).toBe(0);
	});

	it("prefers shorter paths when scores tie", () => {
		expect(search(["a/b/c/main.ts", "main.ts"], "main.ts", 5)[0]).toBe("main.ts");
	});

	it("serves matching workspace files", async () => {
		const { body } = await get<FileIndexResponse>("/api/files/index?q=main");
		expect(body.files).toContain("src/main.ts");
		expect(body.files.some((path) => path.startsWith("node_modules"))).toBe(false);
	});
});

describe("git porcelain parsing", () => {
	it("reads status codes and staging state", () => {
		const changes = parsePorcelain("M  src/a.ts\0 M src/b.ts\0?? new.ts\0");
		expect(changes).toEqual([
			{ path: "src/a.ts", status: "modified", staged: true },
			{ path: "src/b.ts", status: "modified", staged: false },
			{ path: "new.ts", status: "untracked", staged: false },
		]);
	});

	it("skips the source record of a rename", () => {
		const changes = parsePorcelain("R  new.ts\0old.ts\0 M other.ts\0");
		expect(changes.map((change) => change.path)).toEqual(["new.ts", "other.ts"]);
		expect(changes[0]?.status).toBe("renamed");
	});
});

describe("git routes", () => {
	it("says so when the directory is not a repository", async () => {
		const { body } = await get<GitStatusResponse>("/api/git/status");
		expect(body.isRepository).toBe(false);
		expect(body.changes).toEqual([]);
	});

	it("reports changes and diffs inside a repository", async () => {
		const repo = join(workspace, "repo");
		mkdirSync(repo);
		const run = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
		run(["init", "-q", "-b", "main"]);
		run(["config", "user.email", "test@example.com"]);
		run(["config", "user.name", "Test"]);
		writeFileSync(join(repo, "tracked.txt"), "one\n");
		run(["add", "tracked.txt"]);
		run(["commit", "-qm", "first"]);
		writeFileSync(join(repo, "tracked.txt"), "one\ntwo\n");
		writeFileSync(join(repo, "fresh.txt"), "brand new\n");

		const status = await get<GitStatusResponse>("/api/git/status?cwd=repo");
		expect(status.body.isRepository).toBe(true);
		expect(status.body.branch).toBe("main");
		expect(status.body.changes).toEqual(
			expect.arrayContaining([
				{ path: "tracked.txt", status: "modified", staged: false },
				{ path: "fresh.txt", status: "untracked", staged: false },
			]),
		);

		const tracked = await get<GitDiffResponse>("/api/git/diff?cwd=repo&path=repo/tracked.txt");
		expect(tracked.body.supported).toBe(true);
		expect(tracked.body.patch).toContain("+two");

		// An untracked file has no committed side, so the patch is synthesised.
		const fresh = await get<GitDiffResponse>("/api/git/diff?cwd=repo&path=repo/fresh.txt");
		expect(fresh.body.supported).toBe(true);
		expect(fresh.body.patch).toContain("new file mode");
		expect(fresh.body.patch).toContain("+brand new");
	});
});
