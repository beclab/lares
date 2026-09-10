/**
 * Lares slash-command discovery under /api/lares/commands.
 *
 * dsh publishes its command registry over a Typert remote, which the LarePass
 * client's plain `POST /api/<method>` transport cannot reach — so the composer
 * would have to hardcode the names it offers, and drift from whatever the
 * deployment actually registers. This route reads the live registry instead.
 * Running a command needs nothing extra: `session.prompt` already dispatches a
 * single text block starting with `/` to the registry.
 */
import { createRouteHandler, sendJson } from "@olares/lares-core/tools/http";

export const name = "lares-session-commands";
export const inject = [
  "webServer",
  "commands",
  "agents",
  "fileReferences",
  "sessionReferenceResolver",
];

const ROUTE_PREFIX = "/api/lares/commands";
const REFERENCES_PREFIX = "/api/lares/references";

function sessionIdOf(req) {
  return new URL(req.url ?? "/", "http://lares").searchParams.get("sessionId") ?? "";
}

/**
 * `commands.list` is keyed by a live agent: the global definitions plus the
 * shadows that agent's own scoped layer adds. A session the client has only
 * opened has no agent yet — dsh resumes one on the first prompt — and resuming
 * a whole agent (sandbox, tools, model composition) to fill a menu would be a
 * heavy side effect for a read. Any live root therefore stands in for the
 * global layer, and a host with no live agent answers an empty list.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
function agentFor(ctx, sessionId) {
  return (sessionId ? ctx.agents.get(sessionId) : undefined) ?? ctx.agents.roots()[0];
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
function commandList(ctx, sessionId) {
  const agent = agentFor(ctx, sessionId);
  if (!agent) return { commands: [], scoped: false };
  return {
    commands: ctx.commands.list(agent).map((row) => ({
      name: row.name,
      description: row.description,
      ...(row.input ? { input: { hint: row.input.hint, images: Boolean(row.input.images) } } : {}),
    })),
    scoped: agent.id === sessionId,
  };
}

function queryOf(req) {
  const url = new URL(req.url ?? "/", "http://lares");
  return {
    sessionId: url.searchParams.get("sessionId") ?? "",
    query: url.searchParams.get("query") ?? "",
  };
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
async function referenceList(ctx, req) {
  const { sessionId, query } = queryOf(req);
  const agent = sessionId ? ctx.agents.get(sessionId) : undefined;
  if (!agent) return { files: [], sessions: [] };
  const signal = new AbortController().signal;
  const [files, sessions] = await Promise.all([
    ctx.fileReferences.list(agent, query, signal),
    ctx.sessionReferenceResolver.remoteExportCandidates(agent, query, signal),
  ]);
  return { files, sessions };
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
function handler(ctx) {
  return createRouteHandler({
    prefix: ROUTE_PREFIX,
    routes: {
      "/": {
        GET: async (req, res) => sendJson(res, 200, commandList(ctx, sessionIdOf(req))),
      },
    },
    fallbackCode: "commands_failed",
  });
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
function referencesHandler(ctx) {
  return createRouteHandler({
    prefix: REFERENCES_PREFIX,
    routes: {
      "/": {
        GET: async (req, res) => sendJson(res, 200, await referenceList(ctx, req)),
      },
    },
    fallbackCode: "references_failed",
  });
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  ctx.effect(() => {
    const disposeCommands = ctx.webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler: handler(ctx) });
    const disposeReferences = ctx.webServer.register({
      kind: "prefix",
      path: REFERENCES_PREFIX,
      handler: referencesHandler(ctx),
    });
    return () => {
      disposeReferences();
      disposeCommands();
    };
  }, "lares-session-composer-routes");
}
