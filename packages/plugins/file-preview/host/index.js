import { HttpError, createRouteHandler, sendJson } from "../../shared/host/http.js";
import { findWorkspaceForSession } from "../../file-input/host/storage.js";
import { buildPreview, resolveWorkspaceFile, sendRawFile } from "./files.js";

export const name = "lares-file-preview";
export const inject = ["webServer", "workspaceRegistry"];

const ROUTE_PREFIX = "/api/lares/file-preview";

async function resolveRequestFile(req, workspaceRegistry) {
  const url = new URL(req.url ?? "/", "http://x");
  const sessionId = url.searchParams.get("sessionId");
  const path = url.searchParams.get("path");
  if (!sessionId) throw new HttpError("session_required", 400, "session id is required");
  if (!path) throw new HttpError("path_invalid", 400, "file path is required");
  const workspace = findWorkspaceForSession(workspaceRegistry, sessionId);
  if (workspace === null) {
    throw new HttpError("workspace_not_found", 404, "session workspace was not found");
  }
  if ((await workspace.status()) !== "ok") {
    throw new HttpError("workspace_unavailable", 409, "session workspace is unavailable");
  }
  return resolveWorkspaceFile(workspace.path, path);
}

export function createPreviewHandler(workspaceRegistry) {
  return async (req, res) => {
    const file = await resolveRequestFile(req, workspaceRegistry);
    sendJson(res, 200, await buildPreview(file));
  };
}

export function createRawHandler(workspaceRegistry) {
  return async (req, res) => {
    const file = await resolveRequestFile(req, workspaceRegistry);
    sendRawFile(req, res, file);
  };
}

export function apply(ctx) {
  const preview = createPreviewHandler(ctx.workspaceRegistry);
  const raw = createRawHandler(ctx.workspaceRegistry);
  const handler = createRouteHandler({
    prefix: ROUTE_PREFIX,
    routes: {
      "/preview": { GET: preview },
      "/raw": { GET: raw, HEAD: raw },
    },
    fallbackCode: "file_preview_failed",
  });
  ctx.effect(
    () => ctx.webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler }),
    "lares-file-preview-routes",
  );
}
