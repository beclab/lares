import { lstatSync } from "node:fs";
import { mkdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { HttpError } from "../tools/http.js";

export function isInsideWorkspace(root, target) {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

export async function resolveWorkspaceRoot(workspacePath) {
  return realpath(workspacePath).catch(() => {
    throw new HttpError("workspace_unavailable", 409, "session workspace is unavailable");
  });
}

/**
 * Preview only serves the session workspace. Agents sometimes write
 * `/app/name.ext` (the application overlay) while the open chip still points
 * there; alias that basename into the workspace. Nested overlay paths
 * (`/app/packages/x`) and any other filesystem root (`/tmp/x`) stay forbidden.
 */
export function workspaceFileAlias(root, requestedPath) {
  if (typeof requestedPath !== "string" || !isAbsolute(requestedPath)) return null;
  if (isInsideWorkspace(root, requestedPath)) return null;
  if (dirname(requestedPath) !== "/app") return null;
  const base = basename(requestedPath);
  if (!base || base === "." || base === "..") return null;
  return base;
}

export function workspaceCandidate(root, requestedPath) {
  const candidate = resolve(root, requestedPath);
  if (!isInsideWorkspace(root, candidate)) {
    throw new HttpError("path_forbidden", 403, "path leaves the session workspace");
  }
  return candidate;
}

export async function resolveExistingWorkspacePath(root, candidate) {
  const absolutePath = await realpath(candidate).catch(() => {
    throw new HttpError("file_not_found", 404, "file was not found");
  });
  if (!isInsideWorkspace(root, absolutePath)) {
    throw new HttpError("path_forbidden", 403, "path leaves the session workspace");
  }
  return absolutePath;
}

export async function ensureWorkspaceDirectory(workspacePath, parts) {
  const root = await resolveWorkspaceRoot(workspacePath);
  let current = root;
  for (const part of parts) {
    const candidate = workspaceCandidate(current, part);
    await mkdir(candidate).catch((error) => {
      if (error?.code !== "EEXIST") throw error;
    });
    current = await realpath(candidate).catch(() => {
      throw new HttpError("workspace_unavailable", 409, "workspace directory is unavailable");
    });
    if (!isInsideWorkspace(root, current)) {
      throw new HttpError("path_forbidden", 403, "workspace directory leaves the session workspace");
    }
    const info = await stat(current);
    if (!info.isDirectory()) {
      throw new HttpError("workspace_unavailable", 409, "workspace path is not a directory");
    }
  }
  return { root, directory: current };
}

/**
 * Absolute path a workspace write will occupy. Refuses to clobber a symlink
 * or non-file; an existing regular file needs `overwrite`.
 */
export async function prepareWorkspaceTarget(root, destination, overwrite) {
  const segments = destination.split("/");
  const { directory } = await ensureWorkspaceDirectory(root, segments.slice(0, -1));
  const absolutePath = workspaceCandidate(directory, segments.at(-1));
  let current = null;
  try {
    current = lstatSync(absolutePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (current !== null) {
    if (!overwrite) {
      throw new Error(`${destination} already exists; pass overwrite or choose another destination`);
    }
    if (current.isSymbolicLink() || !current.isFile()) {
      throw new Error(`${destination} cannot overwrite a symlink or non-regular file`);
    }
  }
  return absolutePath;
}
