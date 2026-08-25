import { HttpError } from "./http.js";
import { resolveWorkspaceRoot } from "./workspace-path.js";

/**
 * The directory a session owns is its own header `cwd`. Registry membership is
 * dsh's grouping account instead: it is written only when the client names a
 * workspaceId while creating the session, so an ordinary new chat is ungrouped
 * and has no membership at all while still working in a real directory.
 *
 * The registry stays in the lookup as the boundary of what this deployment
 * serves — a cwd that is not a registered workspace path is refused, so a
 * session created with an arbitrary cwd cannot read outside those directories.
 *
 * @param ctx - Cordis context carrying `workspaceRegistry` and `sessionPersistence`.
 * @param sessionId - Session the request claims to act for.
 */
export async function resolveSessionWorkspace(ctx, sessionId) {
  if (typeof sessionId !== "string" || !sessionId) {
    throw new HttpError("session_required", 400, "session id is required");
  }
  const cwd = await sessionCwd(ctx, sessionId);
  if (cwd === null) {
    throw new HttpError("workspace_not_found", 404, "session workspace was not found");
  }
  const workspace = await ctx.workspaceRegistry.resolveByPath(await resolveWorkspaceRoot(cwd));
  if (workspace === undefined) {
    throw new HttpError("workspace_not_found", 404, "session workspace was not found");
  }
  if ((await workspace.status()) !== "ok") {
    throw new HttpError("workspace_unavailable", 409, "session workspace is unavailable");
  }
  return workspace;
}

/** Live sessions answer without touching storage; anything else needs the log header. */
async function sessionCwd(ctx, sessionId) {
  const live = ctx.get("sessions")?.get(sessionId);
  if (typeof live?.header?.cwd === "string") return live.header.cwd;
  const headers = await ctx.sessionPersistence.list();
  const cwd = headers.find((header) => String(header.id) === sessionId)?.cwd;
  return typeof cwd === "string" ? cwd : null;
}
