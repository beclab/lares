import { spawn } from "node:child_process";
import { parseFilesPath } from "./files-path.js";

const STDERR_LIMIT = 2000;
const STDOUT_LIMIT = 8 * 1024 * 1024;

function lookupError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Children of one `olares-cli files ls --json` envelope.
 * Drive-like namespaces use `items`; cloud namespaces use `data`.
 */
export function filesLsChildren(envelope) {
  if (envelope == null || typeof envelope !== "object") return [];
  const body = envelope.data !== undefined && !Array.isArray(envelope.items)
    ? envelope.data
    : envelope;
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    if (Array.isArray(body.items)) return body.items;
    if (Array.isArray(body.data)) return body.data;
  }
  return [];
}

function itemLeaf(item) {
  const raw = String(item?.name ?? item?.fileName ?? "").replace(/\/$/, "");
  const parts = raw.split("/");
  return parts.at(-1) ?? "";
}

function isDirectoryItem(item) {
  if (item?.isDir === true || item?.isDirectory === true) return true;
  const type = String(item?.type ?? "").toLowerCase();
  if (type === "dir" || type === "directory") return true;
  return typeof item?.name === "string" && item.name.endsWith("/");
}

function itemSize(item) {
  const n = Number(item?.size ?? item?.fileSize);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function itemModifiedAt(item) {
  const t = Date.parse(item?.modified ?? item?.mtime ?? item?.modTime ?? "");
  return Number.isFinite(t) ? t : 0;
}

export function findFilesChild(envelope, name) {
  return filesLsChildren(envelope).find((item) => itemLeaf(item) === name) ?? null;
}

/**
 * List one files-backend directory. Identity is already in `process.env`.
 * @param spawnFn - seam for tests; the real spawn otherwise.
 */
export function runOlaresLs(parent, options = {}) {
  const { signal, spawnFn = spawn } = options;
  return new Promise((resolve, reject) => {
    const child = spawnFn("olares-cli", ["files", "ls", parent, "--json"], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      ...(signal ? { signal } : {}),
    });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    child.stdout?.on("data", (chunk) => {
      if (truncated) return;
      stdout += chunk;
      if (stdout.length > STDOUT_LIMIT) {
        truncated = true;
        stdout = "";
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-STDERR_LIMIT);
    });
    child.on("error", (error) => {
      reject(lookupError("files_unavailable", `olares-cli files ls failed: ${error.message}`));
    });
    child.on("close", (code) => {
      if (truncated) {
        reject(lookupError("files_unavailable", "olares-cli files ls output exceeded the read limit"));
        return;
      }
      if (code !== 0) {
        reject(lookupError(
          "files_unavailable",
          `olares-cli files ls exited ${code}: ${stderr.trim() || "no output"}`,
        ));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(lookupError("files_unavailable", "olares-cli files ls returned invalid JSON"));
      }
    });
  });
}

/**
 * Stat one files-backend file by listing its parent and matching the leaf.
 * Direct GET of the file URL can 500; parent `ls` is the supported probe.
 */
export async function statFilesFile(source, options = {}) {
  const path = parseFilesPath(source);
  const cut = path.lastIndexOf("/");
  const parent = path.slice(0, cut);
  const name = path.slice(cut + 1);
  const envelope = await (options.ls ?? runOlaresLs)(parent, options);
  const item = findFilesChild(envelope, name);
  if (!item) throw lookupError("file_not_found", `${path} was not found`);
  if (isDirectoryItem(item)) throw lookupError("path_not_file", `${path} is not a regular file`);
  return {
    path,
    name,
    size: itemSize(item),
    modifiedAt: itemModifiedAt(item),
  };
}
