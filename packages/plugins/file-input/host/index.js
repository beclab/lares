import { HttpError, createRouteHandler, sendJson } from "../../shared/host/http.js";
import { findWorkspaceForSession, sanitizeFilename, saveUpload } from "./storage.js";

export const name = "lares-file-input";
export const inject = ["webServer", "workspaceRegistry"];

const ROUTE_PREFIX = "/api/lares/files";
const REQUEST_ID = /^[A-Za-z0-9_-]{16,80}$/;

function decodeFilename(value) {
  if (typeof value !== "string" || !value) return "file";
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError("filename_invalid", 400, "invalid file name");
  }
}

export function createUploadHandler(workspaceRegistry) {
  return async (req, res) => {
    const sessionId = req.headers["x-lares-session-id"];
    if (typeof sessionId !== "string" || !sessionId) {
      throw new HttpError("session_required", 400, "session id is required");
    }
    const workspace = findWorkspaceForSession(workspaceRegistry, sessionId);
    if (workspace === null) {
      throw new HttpError("workspace_not_found", 404, "session workspace was not found");
    }
    if ((await workspace.status()) !== "ok") {
      throw new HttpError("workspace_unavailable", 409, "session workspace is unavailable");
    }

    const requestId = req.headers["x-lares-upload-request-id"];
    if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) {
      throw new HttpError("upload_request_invalid", 400, "valid upload request id is required");
    }
    const filename = decodeFilename(req.headers["x-lares-file-name"]);
    const safeName = sanitizeFilename(filename);
    const log = { requestId, sessionId, name: safeName };
    console.log("[lares:file-upload]", JSON.stringify({ event: "start", ...log }));
    try {
      const stored = await saveUpload(req, workspace.path, filename);
      console.log("[lares:file-upload]", JSON.stringify({
        event: "committed",
        ...log,
        path: stored.path,
        size: stored.size,
      }));
      sendJson(res, 201, {
        path: stored.path,
        name: safeName,
        size: stored.size,
        mediaType: String(req.headers["content-type"] || "application/octet-stream").split(";", 1)[0],
      });
    } catch (error) {
      console.error("[lares:file-upload]", JSON.stringify({
        event: "failed",
        ...log,
        code: error?.code ?? "file_upload_failed",
        message: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  };
}

export function apply(ctx) {
  const handler = createRouteHandler({
    prefix: ROUTE_PREFIX,
    routes: {
      "/upload": { POST: createUploadHandler(ctx.workspaceRegistry) },
    },
    fallbackCode: "file_upload_failed",
  });
  ctx.effect(
    () => ctx.webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler }),
    "lares-file-input-routes",
  );
}
