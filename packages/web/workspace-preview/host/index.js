import { createRouteHandler, sendJson } from "@lares/core/tools/http";
import { resolveSessionWorkspace } from "@lares/core/workspace/session";
import {
  buildPreview,
  previewQueryFromUrl,
  resolveWorkspaceFile,
  sendFileDownload,
  sendRawFile,
} from "@lares/core/files/preview";

export const name = "lares-workspace-preview";
export const inject = ["webServer", "workspaceRegistry", "sessionPersistence"];

const ROUTE_PREFIX = "/api/lares/file-preview";

async function resolveRequestFile(req, ctx) {
  const { path, sessionId } = previewQueryFromUrl(req.url);
  const workspace = await resolveSessionWorkspace(ctx, sessionId);
  return resolveWorkspaceFile(workspace.path, path);
}

export function createPreviewHandler(ctx) {
  return async (req, res) => {
    const file = await resolveRequestFile(req, ctx);
    sendJson(res, 200, await buildPreview(file));
  };
}

export function createRawHandler(ctx) {
  return async (req, res) => {
    const file = await resolveRequestFile(req, ctx);
    await sendRawFile(req, res, file);
  };
}

export function createDownloadHandler(ctx) {
  return async (req, res) => {
    const file = await resolveRequestFile(req, ctx);
    await sendFileDownload(req, res, file);
  };
}

export function apply(ctx) {
  const preview = createPreviewHandler(ctx);
  const raw = createRawHandler(ctx);
  const download = createDownloadHandler(ctx);
  const handler = createRouteHandler({
    prefix: ROUTE_PREFIX,
    routes: {
      "/preview": { GET: preview },
      "/raw": { GET: raw, HEAD: raw },
      "/download": { GET: download, HEAD: download },
    },
    fallbackCode: "file_preview_failed",
  });
  ctx.effect(
    () => ctx.webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler }),
    "lares-workspace-preview-routes",
  );
}
