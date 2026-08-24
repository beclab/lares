import { HttpError, createRouteHandler, sendJson } from "../../shared/host/http.js";
import { findWorkspaceForSession, saveUpload } from "./storage.js";

export const name = "lares-file-input";
export const inject = ["webServer", "workspaceRegistry"];

const ROUTE_PREFIX = "/api/lares/files";

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

    const filename = decodeFilename(req.headers["x-lares-file-name"]);
    const stored = await saveUpload(req, workspace.path, filename);
    sendJson(res, 201, {
      path: stored.path,
      name: filename,
      size: stored.size,
      mediaType: String(req.headers["content-type"] || "application/octet-stream").split(";", 1)[0],
    });
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
