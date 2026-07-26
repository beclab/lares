/**
 * Makes an absolute path relative to the workspace root.
 *
 * The file routes only accept workspace-relative paths, but sessions and
 * worktrees are identified by absolute path, so this is the seam between the
 * two. `/api/config` reports the resolved root for exactly this reason: the
 * comparison is a string prefix, so a root that still passes through a symlink
 * would never match the real paths the API returns.
 *
 * Anything outside the root falls back to the root itself rather than throwing,
 * because the caller's next move is always "show me this directory" and the
 * server rejects an escape anyway.
 */
export function toWorkspaceRelative(root: string | undefined, absolute: string | null | undefined): string {
	if (!root || !absolute || absolute === root) return ".";
	return absolute.startsWith(`${root}/`) ? absolute.slice(root.length + 1) : ".";
}
