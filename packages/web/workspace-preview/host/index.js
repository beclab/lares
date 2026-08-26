import { createRouteHandler, sendJson } from "@lares/core/tools/http";
import { resolveSessionWorkspace } from "@lares/core/workspace/session";
import {
  buildPreview,
  fileFromPreviewRequest,
  sendFileDownload,
  sendRawFile,
} from "@lares/core/files/preview";

export const name = "lares-workspace-preview";
export const inject = ["webServer", "workspaceRegistry", "sessionPersistence"];

const ROUTE_PREFIX = "/api/lares/file-preview";

function workspaceOf(ctx) {
  return (sessionId) => resolveSessionWorkspace(ctx, sessionId);
}

export function createPreviewHandler(ctx) {
  return async (req, res) => {
    const file = await fileFromPreviewRequest(req.url, workspaceOf(ctx));
    sendJson(res, 200, await buildPreview(file));
  };
}

export function createRawHandler(ctx) {
  return async (req, res) => {
    await sendRawFile(req, res, await fileFromPreviewRequest(req.url, workspaceOf(ctx)));
  };
}

export function createDownloadHandler(ctx) {
  return async (req, res) => {
    await sendFileDownload(req, res, await fileFromPreviewRequest(req.url, workspaceOf(ctx)));
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
