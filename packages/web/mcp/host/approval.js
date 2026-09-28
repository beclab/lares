import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  bindMcpClientCapture,
  createMcpAnnotationIndex,
  decideMcpToolGate,
} from "@olares/lares-core/mcp/approval";

const REGISTERED = Symbol.for("lares.mcp.approval-register");

const slot = {
  annotations: null,
  servers: () => [],
};

function sandboxMode(ctx, exec) {
  const session = exec.agent?.session;
  return ctx.sandboxPolicy.resolve(session ? { session } : {}).mode;
}

function ensureRegisterCommits(ctx) {
  if (ctx.tools.register[REGISTERED]) return;
  const register = ctx.tools.register.bind(ctx.tools);
  const wrapped = function registerTool(definition) {
    if (typeof definition?.name === "string") slot.annotations?.commit(definition.name);
    return register(definition);
  };
  wrapped[REGISTERED] = true;
  ctx.tools.register = wrapped;
}

/** Ask before a mutating MCP call unless the session is in full access. */
export function installMcpToolApproval(ctx, servers) {
  slot.annotations = createMcpAnnotationIndex();
  slot.servers = servers;
  bindMcpClientCapture(Client.prototype, slot);
  ensureRegisterCommits(ctx);
  ctx.on("tools/pre-execute", async (exec, next) => {
    if (typeof exec?.name !== "string" || !exec.name.startsWith("mcp__")) return next();
    const prior = await next();
    return decideMcpToolGate({
      name: exec.name,
      annotation: slot.annotations.get(exec.name),
      sandboxMode: sandboxMode(ctx, exec),
      prior,
    });
  });
  return slot.annotations;
}
