import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export class PathDenied extends Error {}

function realOrSelf(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		// The path may not exist yet; the parent check below still applies.
		return path;
	}
}

function isInside(root: string, candidate: string): boolean {
	if (candidate === root) return true;
	const rel = relative(root, candidate);
	return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

/**
 * Resolves a client-supplied path against the workspace and refuses anything
 * that escapes it.
 *
 * Both the request and the workspace go through realpath so a symlink pointing
 * outside cannot be used as a way around the prefix check. Lares serves one
 * user with one workspace, so a single root is the whole access model.
 */
/**
 * The canonical workspace root. Paths returned by `resolveInWorkspace` are
 * real paths, so anything relativising against the root must resolve it the
 * same way or the two disagree wherever the root passes through a symlink.
 */
export function workspaceRoot(workspace: string): string {
	return realOrSelf(resolve(workspace));
}

export function resolveInWorkspace(workspace: string, requested: string | undefined): string {
	const root = workspaceRoot(workspace);
	const target = realOrSelf(resolve(root, requested ?? "."));

	if (!isInside(root, target)) throw new PathDenied(`Path is outside the workspace: ${requested}`);
	return target;
}
