import { basename, isAbsolute, resolve } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { runtimeSkillsDir } from "../skills/state.js";
import { HttpError } from "../tools/http.js";
import { isInsideWorkspace } from "../workspace/path.js";

/**
 * Disk trees the conversation may preview besides the session workspace.
 * Skills are what the agent Reads (`/data/lares/skills/…`); they are Lares
 * app data, not user Drive files, so they stay off `drive/…`.
 */
export function localPreviewRoots(env = process.env) {
  const dataDir = env.LARES_DATA_DIR?.trim() || "/data/lares";
  return [runtimeSkillsDir(dataDir)];
}

async function matchingRoot(candidate, roots) {
  for (const root of roots) {
    const resolvedRoot = await realpath(root).catch(() => null);
    if (!resolvedRoot) continue;
    const resolvedCandidate = await realpath(candidate).catch(() => null);
    if (resolvedCandidate && isInsideWorkspace(resolvedRoot, resolvedCandidate)) {
      return resolvedRoot;
    }
    const lexical = resolve(candidate);
    if (
      isInsideWorkspace(resolvedRoot, lexical)
      || isInsideWorkspace(root, lexical)
    ) {
      return resolvedRoot;
    }
  }
  return null;
}

/**
 * Open a file from a Lares-owned local tree. Returns null when the path is
 * not in one of those trees so the caller can try the session workspace.
 */
export async function resolveLocalPreviewFile(requestedPath, options = {}) {
  if (typeof requestedPath !== "string" || !requestedPath.trim() || requestedPath.includes("\0")) {
    return null;
  }
  if (!isAbsolute(requestedPath)) return null;
  const roots = options.roots ?? localPreviewRoots(options.env ?? process.env);
  const candidate = resolve(requestedPath);
  const root = await matchingRoot(candidate, roots);
  if (!root) return null;
  const absolutePath = await realpath(candidate).catch(() => {
    throw new HttpError("file_not_found", 404, "file was not found");
  });
  if (!isInsideWorkspace(root, absolutePath)) {
    throw new HttpError("path_forbidden", 403, "path leaves the allowed preview tree");
  }
  const info = await stat(absolutePath).catch(() => {
    throw new HttpError("file_not_found", 404, "file was not found");
  });
  if (!info.isFile()) throw new HttpError("path_not_file", 415, "path is not a regular file");
  return {
    origin: "local",
    absolutePath,
    path: requestedPath,
    name: basename(absolutePath),
    size: info.size,
    modifiedAt: info.mtimeMs,
    device: info.dev,
    inode: info.ino,
  };
}
