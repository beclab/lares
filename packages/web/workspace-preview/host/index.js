import { createRouteHandler, sendJson } from "@olares/lares-core/tools/http";
import { resolveSessionWorkspace } from "@olares/lares-core/workspace/session";
import { filesClientFromRequest } from "@olares/lares-core/files/backend-client";
import {
  buildPreview,
  fileFromPreviewRequest,
  sendFileDownload,
  sendRawFile,
} from "@olares/lares-core/files/preview";

export const name = "lares-workspace-preview";
export const inject = ["webServer", "workspaceRegistry", "sessionPersistence"];

const ROUTE_PREFIX = "/api/lares/file-preview";

function workspaceOf(ctx) {
  return (sessionId) => resolveSessionWorkspace(ctx, sessionId);
}

function filesDeps(req, res) {
  const controller = new AbortController();
  req.once?.("aborted", () => controller.abort());
  res.once?.("close", () => controller.abort());
  let client;
  const current = () => {
    client ??= filesClientFromRequest(req, { signal: controller.signal });
    return client;
  };
  return {
    stat: (source) => current().stat(source),
    readFilesRaw: (source, maxBytes) => current().readRaw(source, maxBytes),
    openFilesRaw: (source, options) => current().openRaw(source, options),
  };
}

export function createPreviewHandler(ctx) {
  return async (req, res) => {
    const deps = filesDeps(req, res);
    const file = await fileFromPreviewRequest(req.url, workspaceOf(ctx), deps);
    sendJson(res, 200, await buildPreview(file, deps));
  };
}

export function createRawHandler(ctx) {
  return async (req, res) => {
    const deps = filesDeps(req, res);
    await sendRawFile(req, res, await fileFromPreviewRequest(req.url, workspaceOf(ctx), deps), deps);
  };
}

export function createDownloadHandler(ctx) {
  return async (req, res) => {
    const deps = filesDeps(req, res);
    await sendFileDownload(req, res, await fileFromPreviewRequest(req.url, workspaceOf(ctx), deps), deps);
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
