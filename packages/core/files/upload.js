import { createWriteStream, existsSync, openSync, rmSync, statSync } from "node:fs";
import { rename } from "node:fs/promises";
import { extname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { HttpError } from "../tools/http.js";
import { ensureWorkspaceDirectory } from "../workspace/path.js";
import { sanitizeFilename } from "./filename.js";
import { DEFAULT_MAX_UPLOAD_BYTES } from "./limits.js";

export { DEFAULT_MAX_UPLOAD_BYTES, sanitizeFilename };
export const UPLOAD_REQUEST_ID = /^[A-Za-z0-9_-]{16,80}$/;
const UPLOAD_DIRECTORY = [".lares", "uploads"];
/** More same-named files than any composer batch; past it the name is hostile. */
const MAX_NAME_ATTEMPTS = 200;

export function decodeUploadFilename(value) {
  if (typeof value !== "string" || !value) return "file";
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError("filename_invalid", 400, "invalid file name");
  }
}

/**
 * `report.pdf` → `report-2.pdf`. The number goes before the extension so the
 * file type survives, and the model reading the mention still sees the name the
 * user recognizes.
 */
export function numberedName(name, attempt) {
  if (attempt <= 1) return name;
  const extension = extname(name);
  return `${name.slice(0, name.length - extension.length)}-${attempt}${extension}`;
}

/**
 * Take the first free name for this upload. The exclusive `.part` create is the
 * claim: two uploads of one name race here rather than over the final path, so
 * each ends up with a number of its own.
 */
function claimName(directory, filename) {
  const name = sanitizeFilename(filename);
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
    const candidate = numberedName(name, attempt);
    const absolutePath = join(directory, candidate);
    if (existsSync(absolutePath)) continue;
    const temporary = `${absolutePath}.part`;
    try {
      const fd = openSync(temporary, "wx", 0o600);
      return {
        absolutePath,
        temporary,
        fd,
        relativePath: join(...UPLOAD_DIRECTORY, candidate),
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new HttpError("file_upload_failed", 409, `no free name for "${name}"`);
}

function byteLimit(maxBytes) {
  let total = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      total += chunk.length;
      if (total > maxBytes) {
        callback(new HttpError("file_too_large", 413, `file exceeds ${maxBytes} bytes`));
        return;
      }
      callback(null, chunk);
    },
  });
}

/**
 * Stream one upload into the workspace under the name the user chose.
 * @returns the workspace-relative path the composer mentions, and the bytes stored.
 */
export async function saveUpload(req, workspacePath, filename, maxBytes = DEFAULT_MAX_UPLOAD_BYTES) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError("file_too_large", 413, `file exceeds ${maxBytes} bytes`);
  }

  const { directory } = await ensureWorkspaceDirectory(workspacePath, UPLOAD_DIRECTORY);
  const claim = claimName(directory, filename);
  try {
    await pipeline(
      req,
      byteLimit(maxBytes),
      createWriteStream(claim.temporary, { fd: claim.fd, autoClose: true }),
    );
    const size = statSync(claim.temporary).size;
    if (size === 0) throw new HttpError("file_empty", 400, "file is empty");
    await rename(claim.temporary, claim.absolutePath);
    return { path: claim.relativePath, size };
  } catch (error) {
    rmSync(claim.temporary, { force: true });
    throw error;
  }
}
