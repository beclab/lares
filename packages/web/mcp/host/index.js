import * as mcpClient from "@deepseek-ai/dsh-mcp-client";
import { createRouteHandler, HttpError, readJsonObject, sendJson } from "@olares/lares-core/tools/http";
import {
  loadMcpServers,
  normalizeMcpServer,
  saveMcpServers,
} from "@olares/lares-core/mcp/config";

export const name = "lares-mcp";
export const inject = ["webServer", "tools"];

const ROUTE_PREFIX = "/api/lares/mcp";

function dataDir() {
  return process.env.LARES_DATA_DIR?.trim() || "/data/lares";
}

function runtimeConfig(server) {
  const { enabled: _enabled, ...config } = server;
  return {
    ...config,
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false,
  };
}

class McpManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.servers = [];
    this.fibers = new Map();
    this.errors = new Map();
    this.configError = "";
    this.queue = Promise.resolve();
  }

  async start() {
    try {
      this.servers = loadMcpServers(dataDir());
    } catch (err) {
      this.configError = err instanceof Error ? err.message : String(err);
      this.ctx.logger.error(`MCP configuration ignored: ${this.configError}`);
      return;
    }
    for (const server of this.servers) await this.activate(server);
  }

  panel() {
    return {
      servers: this.servers.map((server) => ({
        ...server,
        runtime: server.enabled
          ? this.errors.has(server.serverName)
            ? { state: "error", message: this.errors.get(server.serverName) }
            : { state: "enabled" }
          : { state: "disabled" },
      })),
      ...(this.configError ? { error: this.configError } : {}),
    };
  }

  run(operation) {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => {});
    return next;
  }

  async activate(server) {
    await this.deactivate(server.serverName);
    this.errors.delete(server.serverName);
    if (!server.enabled) return;
    const fiber = this.ctx.plugin(mcpClient, runtimeConfig(server));
    this.fibers.set(server.serverName, fiber);
    try {
      await fiber;
    } catch (err) {
      this.fibers.delete(server.serverName);
      this.errors.set(server.serverName, err instanceof Error ? err.message : String(err));
      await fiber.dispose();
    }
  }

  async deactivate(serverName) {
    const fiber = this.fibers.get(serverName);
    if (!fiber) return;
    this.fibers.delete(serverName);
    await fiber.dispose();
  }

  save(body) {
    return this.run(async () => {
      const server = normalizeMcpServer(body.server);
      const previousName = typeof body.previousName === "string" ? body.previousName.trim() : "";
      const retained = this.servers.filter((entry) =>
        entry.serverName !== server.serverName && entry.serverName !== previousName
      );
      const next = [...retained, server];
      this.servers = saveMcpServers(dataDir(), next);
      this.configError = "";
      if (previousName && previousName !== server.serverName) {
        await this.deactivate(previousName);
        this.errors.delete(previousName);
      }
      await this.activate(server);
      return this.panel();
    });
  }

  remove(body) {
    return this.run(async () => {
      const serverName = typeof body.serverName === "string" ? body.serverName.trim() : "";
      if (!serverName) throw new HttpError("bad_request", 400, "serverName is required");
      const next = this.servers.filter((server) => server.serverName !== serverName);
      if (next.length === this.servers.length) {
        throw new HttpError("not_found", 404, `unknown MCP server: ${serverName}`);
      }
      this.servers = saveMcpServers(dataDir(), next);
      await this.deactivate(serverName);
      this.errors.delete(serverName);
      return this.panel();
    });
  }

  async dispose() {
    await this.queue.catch(() => {});
    await Promise.all([...this.fibers.keys()].map((serverName) => this.deactivate(serverName)));
  }
}

function routes(manager) {
  return {
    "/": {
      GET: (_req, res) => sendJson(res, 200, manager.panel()),
    },
    "/save": {
      POST: async (req, res) => {
        sendJson(res, 200, await manager.save(await readJsonObject(req)));
      },
    },
    "/remove": {
      POST: async (req, res) => {
        sendJson(res, 200, await manager.remove(await readJsonObject(req)));
      },
    },
  };
}

export async function apply(ctx) {
  const manager = new McpManager(ctx);
  await manager.start();
  ctx.effect(() => () => manager.dispose(), "lares-mcp-runtime");
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: ROUTE_PREFIX,
        handler: createRouteHandler({
          prefix: ROUTE_PREFIX,
          routes: routes(manager),
          fallbackCode: "mcp_failed",
        }),
      }),
    "lares-mcp-routes",
  );
}
