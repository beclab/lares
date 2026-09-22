import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadMcpServers,
  mcpConfigPath,
  normalizeMcpServer,
  saveMcpServers,
} from "@olares/lares-core/mcp/config";

test("MCP HTTP configuration is normalized and persisted with private permissions", () => {
  const root = mkdtempSync(join(tmpdir(), "lares-mcp-"));
  try {
    const server = normalizeMcpServer({
      serverName: "search",
      transport: "streamable-http",
      url: "https://mcp.example.test/api",
      headers: { Authorization: "Bearer secret" },
    });
    assert.equal(server.enabled, true);
    assert.equal(server.url, "https://mcp.example.test/api");
    saveMcpServers(root, [server]);
    assert.deepEqual(loadMcpServers(root), [server]);
    assert.match(readFileSync(mcpConfigPath(root), "utf8"), /Bearer secret/);
    assert.equal(statSync(mcpConfigPath(root)).mode & 0o777, 0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP stdio configuration preserves argv boundaries and environment", () => {
  assert.deepEqual(
    normalizeMcpServer({
      serverName: "filesystem",
      enabled: false,
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/data"],
      env: { HOME: "/tmp/mcp" },
      cwd: "/data",
    }),
    {
      serverName: "filesystem",
      enabled: false,
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/data"],
      env: { HOME: "/tmp/mcp" },
      cwd: "/data",
    },
  );
});

test("MCP configuration rejects unsafe names and malformed transport values", () => {
  assert.throws(
    () => normalizeMcpServer({
      serverName: "bad name",
      transport: "streamable-http",
      url: "https://example.test/mcp",
    }),
    /serverName/,
  );
  assert.throws(
    () => normalizeMcpServer({
      serverName: "search",
      transport: "streamable-http",
      url: "file:///tmp/mcp.sock",
    }),
    /http or https/,
  );
});

test("MCP persistence rejects duplicate server namespaces", () => {
  const root = mkdtempSync(join(tmpdir(), "lares-mcp-"));
  try {
    const server = {
      serverName: "duplicate",
      transport: "stdio",
      command: "node",
    };
    assert.throws(() => saveMcpServers(root, [server, server]), /duplicate serverName/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
