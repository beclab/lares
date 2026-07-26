import { basename, extname } from "node:path";
import type { PreviewKind } from "@lares/shared";

const IMAGE: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".bmp": "image/bmp",
	".ico": "image/x-icon",
	".avif": "image/avif",
};

const AUDIO: Record<string, string> = {
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".ogg": "audio/ogg",
	".oga": "audio/ogg",
	".opus": "audio/ogg",
	".m4a": "audio/mp4",
	".aac": "audio/aac",
	".flac": "audio/flac",
};

const VIDEO: Record<string, string> = {
	".mp4": "video/mp4",
	".webm": "video/webm",
	".mov": "video/quicktime",
	".mkv": "video/x-matroska",
};

const LANGUAGES: Record<string, string> = {
	".ts": "typescript",
	".tsx": "tsx",
	".js": "javascript",
	".jsx": "jsx",
	".mjs": "javascript",
	".cjs": "javascript",
	".vue": "vue",
	".json": "json",
	".jsonc": "json",
	".md": "markdown",
	".markdown": "markdown",
	".css": "css",
	".scss": "scss",
	".sass": "sass",
	".less": "less",
	".html": "html",
	".htm": "html",
	".xml": "xml",
	".svg": "xml",
	".yml": "yaml",
	".yaml": "yaml",
	".toml": "toml",
	".ini": "ini",
	".sh": "bash",
	".bash": "bash",
	".zsh": "bash",
	".fish": "bash",
	".py": "python",
	".rb": "ruby",
	".go": "go",
	".rs": "rust",
	".java": "java",
	".kt": "kotlin",
	".swift": "swift",
	".c": "c",
	".h": "c",
	".cpp": "cpp",
	".cc": "cpp",
	".hpp": "cpp",
	".cs": "csharp",
	".php": "php",
	".sql": "sql",
	".lua": "lua",
	".r": "r",
	".dart": "dart",
	".ex": "elixir",
	".exs": "elixir",
	".hs": "haskell",
	".pl": "perl",
	".graphql": "graphql",
	".proto": "protobuf",
	".dockerfile": "dockerfile",
	".tf": "hcl",
	".patch": "diff",
	".diff": "diff",
};

const BY_NAME: Record<string, string> = {
	dockerfile: "dockerfile",
	makefile: "makefile",
	".gitignore": "gitignore",
	".dockerignore": "gitignore",
	".env": "bash",
	".bashrc": "bash",
	".zshrc": "bash",
};

export function languageOf(path: string): string {
	const name = basename(path).toLowerCase();
	const byName = BY_NAME[name] ?? BY_NAME[name.replace(/\..*$/, "")];
	if (byName) return byName;
	return LANGUAGES[extname(path).toLowerCase()] ?? "text";
}

export function mimeOf(path: string): string {
	const ext = extname(path).toLowerCase();
	if (IMAGE[ext]) return IMAGE[ext];
	if (AUDIO[ext]) return AUDIO[ext];
	if (VIDEO[ext]) return VIDEO[ext];
	if (ext === ".pdf") return "application/pdf";
	if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
	return "application/octet-stream";
}

export function previewKindOf(path: string): PreviewKind {
	const ext = extname(path).toLowerCase();
	if (IMAGE[ext]) return "image";
	if (AUDIO[ext]) return "audio";
	if (VIDEO[ext]) return "video";
	if (ext === ".pdf") return "pdf";
	if (ext === ".docx") return "docx";
	if (ext === ".ipynb") return "notebook";
	if (ext === ".md" || ext === ".markdown") return "markdown";
	return "text";
}

/**
 * Null bytes are the same heuristic git uses to call a file binary, and they
 * are what would otherwise reach the client as replacement characters.
 */
export function looksBinary(sample: Buffer): boolean {
	return sample.includes(0);
}
