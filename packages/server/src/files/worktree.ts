import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { WorktreeInfo } from "@lares/shared";
import { workspaceRoot } from "./paths.ts";

const run = promisify(execFile);

const TIMEOUT_MS = 20_000;
const GIT_ENV = { ...process.env, LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" };

/** Where checkouts live, relative to the workspace root. */
export const WORKTREE_DIR = ".worktrees";

export type WorktreeErrorCode = "not-a-repo" | "dirty" | "exists" | "main" | "git";

export class WorktreeError extends Error {
	readonly code: WorktreeErrorCode;

	constructor(message: string, code: WorktreeErrorCode = "git") {
		super(message);
		this.code = code;
	}
}

async function git(cwd: string, args: string[]): Promise<string> {
	try {
		const { stdout } = await run("git", ["-C", cwd, ...args], { env: GIT_ENV, timeout: TIMEOUT_MS });
		return stdout;
	} catch (err) {
		const detail = err as { stderr?: string; message?: string };
		throw new WorktreeError((detail.stderr || detail.message || "git failed").trim());
	}
}

/**
 * Turns a branch name into a single directory name.
 *
 * `feature/x` would otherwise nest a directory, which makes the checkout hard
 * to find and collides with a branch literally called `feature-x`. Flattening
 * keeps one branch to one visible folder.
 */
export function worktreeDirName(branch: string): string {
	const flattened = branch.replace(/[/\\:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
	if (!flattened || flattened === "." || flattened === "..") throw new WorktreeError(`Unusable branch name: ${branch}`);
	return flattened;
}

interface Repo {
	/** Top level of the checkout the request came from. */
	toplevel: string;
	/** Top level of the main checkout, shared by every worktree. */
	mainRoot: string;
	branch: string | null;
	isWorktree: boolean;
}

export async function describeRepo(cwd: string): Promise<Repo | null> {
	let output: string;
	try {
		output = await git(cwd, [
			"rev-parse",
			"--path-format=absolute",
			"--git-common-dir",
			"--git-dir",
			"--show-toplevel",
			"--abbrev-ref",
			"HEAD",
		]);
	} catch {
		return null;
	}

	const [commonDir, gitDir, toplevel, ref] = output.split("\n").map((line) => line.trim());
	if (!commonDir || !gitDir || !toplevel) return null;

	// A linked worktree has its own gitdir but shares the common dir, and the
	// main checkout is that common dir's parent.
	const isWorktree = gitDir !== commonDir;
	return {
		toplevel,
		mainRoot: isWorktree ? resolve(commonDir, "..") : toplevel,
		branch: ref && ref !== "HEAD" ? ref : null,
		isWorktree,
	};
}

/** Parses `git worktree list --porcelain`, dropping entries whose path is gone. */
export function parseWorktreeList(output: string, exists: (path: string) => boolean = existsSync): WorktreeInfo[] {
	const worktrees: WorktreeInfo[] = [];
	let current: { path?: string; branch: string | null; detached: boolean; locked: boolean; prunable: boolean } | null =
		null;

	const flush = () => {
		if (current?.path && !current.prunable && exists(current.path)) {
			worktrees.push({
				path: current.path,
				branch: current.branch,
				isMain: worktrees.length === 0,
				locked: current.locked,
			});
		}
		current = null;
	};

	for (const line of output.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "") {
			flush();
			continue;
		}
		if (trimmed.startsWith("worktree ")) {
			flush();
			current = { path: trimmed.slice(9), branch: null, detached: false, locked: false, prunable: false };
			continue;
		}
		if (!current) continue;
		if (trimmed.startsWith("branch ")) current.branch = trimmed.slice(7).replace(/^refs\/heads\//, "");
		else if (trimmed === "detached") current.detached = true;
		else if (trimmed.startsWith("locked")) current.locked = true;
		else if (trimmed.startsWith("prunable")) current.prunable = true;
	}
	flush();

	return worktrees;
}

export async function listWorktrees(mainRoot: string): Promise<WorktreeInfo[]> {
	return parseWorktreeList(await git(mainRoot, ["worktree", "list", "--porcelain"]));
}

async function branchExists(mainRoot: string, branch: string): Promise<boolean> {
	try {
		await git(mainRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
		return true;
	} catch {
		return false;
	}
}

/**
 * Keeps a checkout created inside its own repository out of `git status`.
 *
 * This only happens when the repository is the workspace root, since otherwise
 * `.worktrees` sits beside the repository rather than in it. `info/exclude` is
 * the right place for it: local to the clone and never committed.
 */
async function excludeFromRepo(mainRoot: string, worktreeRoot: string): Promise<void> {
	const rel = relative(mainRoot, worktreeRoot);
	if (rel.startsWith("..") || rel === "") return;

	const commonDir = (await git(mainRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
	const excludePath = join(commonDir, "info", "exclude");
	const entry = `/${rel.split(sep).join("/")}/`;

	const current = await readFile(excludePath, "utf8").catch(() => "");
	if (current.split("\n").some((line) => line.trim() === entry)) return;

	await mkdir(join(commonDir, "info"), { recursive: true });
	await appendFile(excludePath, `${current.endsWith("\n") || current === "" ? "" : "\n"}${entry}\n`, "utf8");
}

export interface AddWorktreeOptions {
	workspace: string;
	cwd: string;
	branch: string;
	/** Branch or commit to start a new branch from. Defaults to current HEAD. */
	startPoint?: string;
}

/**
 * Creates a checkout under `<workspace>/.worktrees/<repo>/<branch>`.
 *
 * Everything lives inside the workspace because that is the only tree the file
 * routes will serve, so a checkout placed beside the repository the way git
 * usually suggests would be invisible to the rest of the app.
 */
export async function addWorktree(options: AddWorktreeOptions): Promise<WorktreeInfo> {
	const repo = await describeRepo(options.cwd);
	if (!repo) throw new WorktreeError(`${options.cwd} is not inside a git repository`, "not-a-repo");

	const branch = options.branch.trim();
	if (!branch) throw new WorktreeError("A branch name is required");

	// The real path is what git records and what the path guard hands back, so
	// building on anything else makes the two disagree about the same folder.
	const container = join(workspaceRoot(options.workspace), WORKTREE_DIR);
	const root = join(container, basename(repo.mainRoot));
	const path = join(root, worktreeDirName(branch));
	if (existsSync(path)) throw new WorktreeError(`${path} already exists`, "exists");

	await mkdir(root, { recursive: true });
	await excludeFromRepo(repo.mainRoot, container);

	const args = (await branchExists(repo.mainRoot, branch))
		? ["worktree", "add", "--", path, branch]
		: ["worktree", "add", "-b", branch, "--", path, ...(options.startPoint ? [options.startPoint] : [])];

	await git(repo.mainRoot, args);
	return { path, branch, isMain: false, locked: false };
}

export async function removeWorktree(mainRoot: string, path: string, force: boolean): Promise<void> {
	const worktrees = await listWorktrees(mainRoot);
	const target = worktrees.find((entry) => entry.path === path);
	if (!target) throw new WorktreeError(`${path} is not a checkout of this repository`, "not-a-repo");
	if (target.isMain) throw new WorktreeError("The main checkout cannot be removed", "main");

	try {
		await git(mainRoot, ["worktree", "remove", ...(force ? ["--force"] : []), path]);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		// git refuses rather than discarding work; the caller turns this into an
		// explicit "remove anyway" instead of forcing behind the user's back.
		if (/contains modified or untracked files|is dirty/i.test(message)) {
			throw new WorktreeError(message, "dirty");
		}
		throw err;
	}
}
