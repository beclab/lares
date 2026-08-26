import { createRouteHandler, sendJson } from "@lares/core/tools/http";
import { resolveSessionWorkspace } from "@lares/core/workspace/session";
import { saveUpload } from "@lares/core/files/upload";
import { parseUploadHeaders, uploadSuccessBody } from "@lares/core/files/upload-http";

export const name = "lares-composer-attach";
export const inject = ["webServer", "workspaceRegistry", "sessionPersistence"];

const ROUTE_PREFIX = "/api/lares/files";

export function createUploadHandler(ctx) {
  return async (req, res) => {
    const parsed = parseUploadHeaders(req.headers);
    const workspace = await resolveSessionWorkspace(ctx, parsed.sessionId);
    const log = { requestId: parsed.requestId, sessionId: parsed.sessionId, name: parsed.name };
    console.log("[lares:file-upload]", JSON.stringify({ event: "start", ...log }));
    try {
      const stored = await saveUpload(req, workspace.path, parsed.filename);
      console.log("[lares:file-upload]", JSON.stringify({
        event: "committed",
        ...log,
        path: stored.path,
        size: stored.size,
      }));
      sendJson(res, 201, uploadSuccessBody(stored, parsed.filename, parsed.mediaType));
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
      "/upload": { POST: createUploadHandler(ctx) },
    },
    fallbackCode: "file_upload_failed",
  });
  ctx.effect(
    () => ctx.webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler }),
    "lares-composer-attach-routes",
  );
}
