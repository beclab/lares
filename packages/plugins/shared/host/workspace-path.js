import { mkdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { HttpError } from "./http.js";

export function isInsideWorkspace(root, target) {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

export async function resolveWorkspaceRoot(workspacePath) {
  return realpath(workspacePath).catch(() => {
    throw new HttpError("workspace_unavailable", 409, "session workspace is unavailable");
  });
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
