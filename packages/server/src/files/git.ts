import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitChange, GitFileStatus, GitStatusResponse } from "@lares/shared";

const run = promisify(execFile);

const TIMEOUT_MS = 10_000;
const MAX_BUFFER = 16 * 1024 * 1024;

/** Pinning the locale keeps porcelain output parseable regardless of the host. */
const GIT_ENV = { ...process.env, LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" };

async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await run("git", ["-C", cwd, ...args], {
		env: GIT_ENV,
		timeout: TIMEOUT_MS,
		maxBuffer: MAX_BUFFER,
	});
	return stdout;
}

export async function repositoryRoot(cwd: string): Promise<string | null> {
	try {
		return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim() || null;
	} catch {
		return null;
	}
}

async function currentBranch(cwd: string): Promise<string | null> {
	try {
		const name = (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
		return name === "HEAD" ? "detached" : name;
	} catch {
		return null;
	}
}

function classify(index: string, worktree: string): GitFileStatus {
	if (index === "?" || worktree === "?") return "untracked";
	if (index === "U" || worktree === "U" || (index === "A" && worktree === "A")) return "conflict";
	if (index === "R" || worktree === "R") return "renamed";
	if (index === "A") return "added";
	if (index === "D" || worktree === "D") return "deleted";
	return "modified";
}

/**
 * Parses `status --porcelain=v1 -z`. The NUL separator is what makes paths with
 * spaces or newlines safe, and renames consume a second record for the source.
 */
export function parsePorcelain(stdout: string): GitChange[] {
	const records = stdout.split("\0").filter((record) => record.length > 0);
	const changes: GitChange[] = [];

	for (let i = 0; i < records.length; i += 1) {
		const record = records[i];
		if (!record || record.length < 4) continue;

		const index = record[0] as string;
		const worktree = record[1] as string;
		const path = record.slice(3);

		if (index === "R" || worktree === "R") i += 1;

		changes.push({
			path,
			status: classify(index, worktree),
			staged: index !== " " && index !== "?",
		});
	}

	return changes;
}

export async function gitStatus(cwd: string): Promise<GitStatusResponse> {
	const root = await repositoryRoot(cwd);
	if (!root) return { isRepository: false, root: null, branch: null, changes: [] };

	const [stdout, branch] = await Promise.all([
		git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
		currentBranch(root),
	]);

	return { isRepository: true, root, branch, changes: parsePorcelain(stdout) };
}

/** A synthetic patch, because an untracked file has nothing to diff against. */
function addedPatch(relativePath: string, content: string): string {
	const lines = content.split("\n");
	if (lines.at(-1) === "") lines.pop();

	const header = [
		`diff --git a/${relativePath} b/${relativePath}`,
		"new file mode 100644",
		"--- /dev/null",
		`+++ b/${relativePath}`,
		`@@ -0,0 +1,${lines.length} @@`,
	];
	return [...header, ...lines.map((line) => `+${line}`)].join("\n");
}

export async function gitDiff(
	root: string,
	relativePath: string,
	untracked: boolean,
	content?: string,
): Promise<string> {
	if (untracked) return content === undefined ? "" : addedPatch(relativePath, content);
	return git(root, ["diff", "--no-color", "--no-ext-diff", "--unified=3", "HEAD", "--", relativePath]);
}

/**
 * Lists tracked and untracked files in one call, honouring .gitignore through
 * `--exclude-standard`. Much faster than walking the tree ourselves.
 */
export async function gitListFiles(root: string): Promise<string[] | null> {
	try {
		const stdout = await git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
		return stdout.split("\0").filter((path) => path.length > 0);
	} catch {
		return null;
	}
}
