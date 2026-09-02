import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runOlaresDownload } from "../drive/download.js";
import { sanitizeFilename } from "./filename.js";

const inflight = new Map();

export function previewCacheRoot(env = process.env) {
  const root = env.LARES_DATA_DIR?.trim();
  return join(root || "/data/lares", "preview-cache");
}

function cacheDir(cacheRoot, source) {
  const id = createHash("sha256").update(source).digest("hex").slice(0, 24);
  return join(cacheRoot, id);
}

async function readMeta(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // Missing or corrupt meta is a cache miss.
  }
  return null;
}

async function localSize(path) {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

async function attachLocal(file, absolutePath) {
  const info = await stat(absolutePath);
  return {
    ...file,
    absolutePath,
    size: info.size,
    modifiedAt: info.mtimeMs,
    device: info.dev,
    inode: info.ino,
  };
}

async function materializeOnce(file, options) {
  const download = options.download ?? runOlaresDownload;
  const cacheRoot = options.cacheRoot ?? previewCacheRoot(options.env);
  const dir = cacheDir(cacheRoot, file.path);
  const dest = join(dir, sanitizeFilename(file.name));
  const metaPath = join(dir, "meta.json");
  const expected = { source: file.path, size: file.size, modifiedAt: file.modifiedAt };

  const meta = await readMeta(metaPath);
  const size = await localSize(dest);
  const metaMatches = meta?.source === expected.source
    && meta?.size === expected.size
    && meta?.modifiedAt === expected.modifiedAt;

  if (metaMatches && size === expected.size) return attachLocal(file, dest);

  await mkdir(dir, { recursive: true });
  await writeFile(metaPath, JSON.stringify(expected));
  const resume = metaMatches && size !== null && size < expected.size;
  await download(file.path, dest, {
    signal: options.signal,
    overwrite: !resume,
    resume,
    ...(options.spawnFn ? { spawnFn: options.spawnFn } : {}),
  });
  const next = await localSize(dest);
  if (next !== expected.size) {
    const error = new Error(
      `downloaded size ${next} does not match files backend size ${expected.size}`,
    );
    error.code = "files_unavailable";
    throw error;
  }
  return attachLocal(file, dest);
}

/**
 * Copy one files-backend file into `$LARES_DATA_DIR/preview-cache` so range
 * streaming can use a local handle. Concurrent requests for the same source
 * share one download; a matching size/mtime reuses the cache.
 */
export function materializeFilesFile(file, options = {}) {
  const key = file.path;
  const pending = inflight.get(key);
  if (pending) return pending;
  const done = materializeOnce(file, options).finally(() => {
    if (inflight.get(key) === done) inflight.delete(key);
  });
  inflight.set(key, done);
  return done;
}
