/** How the UI should render a file, decided server-side from its extension. */
export type PreviewKind = "text" | "markdown" | "image" | "audio" | "video" | "pdf" | "docx" | "notebook" | "binary";

export interface DirEntry {
	name: string;
	/** Path relative to the workspace root, which is what every route expects. */
	path: string;
	isDir: boolean;
	size: number;
	modified: string;
	/** Present only for files inside a git repository with pending changes. */
	gitStatus?: GitFileStatus;
}

export interface DirListing {
	path: string;
	parent: string | null;
	entries: DirEntry[];
}

export interface FileMeta {
	path: string;
	size: number;
	modified: string;
	language: string;
	mime: string;
	previewKind: PreviewKind;
	/** True when the file is too large or too binary to send as text. */
	tooLarge: boolean;
}

export interface FileContent extends FileMeta {
	content: string;
}

export interface FileIndexResponse {
	/** Workspace-relative paths, ordered by match quality when a query was given. */
	files: string[];
	/** True when the index hit its cap, so the client should keep querying the server. */
	truncated: boolean;
}

export type GitFileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict";

export interface GitChange {
	path: string;
	status: GitFileStatus;
	staged: boolean;
}

export interface GitStatusResponse {
	isRepository: boolean;
	root: string | null;
	branch: string | null;
	changes: GitChange[];
}

export interface WorktreeInfo {
	/** Absolute path, since it is also a session's working directory. */
	path: string;
	/** Null when the checkout is on a detached HEAD. */
	branch: string | null;
	isMain: boolean;
	locked: boolean;
}

export interface WorktreeListResponse {
	isRepository: boolean;
	/** Top level of the main checkout, shared by every worktree. */
	mainRoot: string | null;
	/** The checkout the requested directory belongs to. */
	current: string | null;
	worktrees: WorktreeInfo[];
}

export interface GitDiffResponse {
	supported: boolean;
	status?: GitFileStatus;
	patch?: string;
	reason?: string;
}
