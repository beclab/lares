import { createHash } from "node:crypto";

/**
 * MCP calls follow the session permission preset.
 *
 * Full access (`danger-full-access`) runs every MCP tool. Read-only and
 * workspace-write allow a tool that declares `readOnlyHint`, and ask before
 * any other MCP tool — the same approval seam a local write uses when the
 * sandbox does not already allow the effect. Public names must match
 * `@deepseek-ai/dsh-mcp-client` (`mcp__<server>__<tool>`, hashed when lossy).
 */

const MAX_PUBLIC_NAME_LENGTH = 64;
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g;
const HASH_LENGTH = 12;
const CAPTURE = Symbol.for("lares.mcp.client-capture");

export function mcpPublicToolName(serverName, rawName) {
  const joined = `mcp__${serverName}__${rawName}`;
  const normalized = joined.replace(INVALID_NAME_CHARS, "_");
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized;
  const hash = createHash("sha256").update(`${serverName}\0${rawName}`).digest("hex").slice(0, HASH_LENGTH);
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`;
}

/** MCP's default is that a tool may modify state unless it says otherwise. */
export function mcpToolMutates(annotations) {
  return annotations?.readOnlyHint !== true;
}

export function decideMcpToolGate({ name, annotation, sandboxMode, prior }) {
  if (!prior || prior.kind !== "allow") return prior;
  if (typeof name !== "string" || !name.startsWith("mcp__")) return prior;
  if (sandboxMode === "danger-full-access") return prior;
  if (annotation !== undefined && !mcpToolMutates(annotation)) return prior;
  return { kind: "ask" };
}

function readOnlyAnnotation(annotations) {
  return annotations?.readOnlyHint === true ? { readOnlyHint: true } : {};
}

export function createMcpAnnotationIndex() {
  const pendingByServer = new Map();
  const live = new Map();
  const liveByServer = new Map();

  return {
    stage(serverName, { first, tools }) {
      const pending = first || !pendingByServer.has(serverName) ? new Map() : pendingByServer.get(serverName);
      pendingByServer.set(serverName, pending);
      for (const tool of tools) {
        if (!tool || typeof tool.name !== "string" || tool.name === "") continue;
        pending.set(mcpPublicToolName(serverName, tool.name), readOnlyAnnotation(tool.annotations));
      }
    },
    commit(publicName) {
      for (const [serverName, pending] of pendingByServer) {
        if (!pending.has(publicName)) continue;
        live.set(publicName, pending.get(publicName));
        let names = liveByServer.get(serverName);
        if (!names) {
          names = new Set();
          liveByServer.set(serverName, names);
        }
        names.add(publicName);
        return;
      }
    },
    drop(serverName) {
      pendingByServer.delete(serverName);
      const names = liveByServer.get(serverName);
      liveByServer.delete(serverName);
      if (!names) return;
      for (const publicName of names) live.delete(publicName);
    },
    get(publicName) {
      return live.has(publicName) ? live.get(publicName) : undefined;
    },
  };
}

export function recordMcpToolPage(index, serverName, request, result) {
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  index.stage(serverName, { first: !request?.params?.cursor, tools });
}

function sameList(left, right) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function sameUrl(configured, actual) {
  try {
    return new URL(configured).href === new URL(actual).href;
  } catch {
    return false;
  }
}

function transportUrl(transport) {
  const url = transport?._url;
  if (typeof url === "string") return url;
  return typeof url?.href === "string" ? url.href : "";
}

export function mcpServerNameForTransport(transport, servers) {
  if (!transport || !Array.isArray(servers)) return undefined;
  const url = transportUrl(transport);
  if (url) {
    return servers.find((server) =>
      server?.enabled !== false
      && server.transport === "streamable-http"
      && sameUrl(server.url, url)
    )?.serverName;
  }
  const params = transport._serverParams;
  if (!params || typeof params.command !== "string") return undefined;
  return servers.find((server) =>
    server?.enabled !== false
    && server.transport === "stdio"
    && server.command === params.command
    && sameList(server.args, params.args)
    && String(server.cwd ?? "") === String(params.cwd ?? "")
  )?.serverName;
}

/** Observe `tools/list` on an MCP `Client` prototype and stage annotations. */
export function bindMcpClientCapture(proto, gate) {
  if (proto[CAPTURE]) {
    proto[CAPTURE].gate = gate;
    return;
  }
  const connect = proto.connect;
  const request = proto.request;
  const state = { gate, clients: new WeakMap() };
  proto.connect = async function connectCaptured(transport, ...rest) {
    const serverName = mcpServerNameForTransport(transport, state.gate.servers());
    if (serverName) state.clients.set(this, serverName);
    return connect.call(this, transport, ...rest);
  };
  proto.request = async function requestCaptured(req, ...rest) {
    const result = await request.call(this, req, ...rest);
    const serverName = state.clients.get(this);
    if (serverName && req?.method === "tools/list") {
      recordMcpToolPage(state.gate.annotations, serverName, req, result);
    }
    return result;
  };
  proto[CAPTURE] = state;
}
