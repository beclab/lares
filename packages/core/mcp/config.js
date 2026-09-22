import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonFile } from "../tools/json-file.js";

const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_SERVERS = 32;
const MAX_ENTRIES = 64;

export class McpConfigError extends Error {
  constructor(message) {
    super(message);
    this.code = "invalid_mcp_server";
    this.status = 400;
  }
}

export function mcpConfigPath(dataDir) {
  return join(dataDir, "mcp", "servers.json");
}

function requiredString(value, field, max = 2048) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new McpConfigError(`${field} is required`);
  if (text.length > max) throw new McpConfigError(`${field} is too long`);
  return text;
}

function stringRecord(value, field) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new McpConfigError(`${field} must be an object`);
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_ENTRIES) throw new McpConfigError(`${field} has too many entries`);
  return Object.fromEntries(entries.map(([key, item]) => {
    const name = requiredString(key, `${field} key`, 256);
    if (typeof item !== "string" || item.length > 8192) {
      throw new McpConfigError(`${field}.${name} must be a string`);
    }
    return [name, item];
  }));
}

function stringArray(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) {
    throw new McpConfigError(`${field} must be an array with at most ${MAX_ENTRIES} entries`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.length > 8192) {
      throw new McpConfigError(`${field}[${index}] must be a string`);
    }
    return item;
  });
}

export function normalizeMcpServer(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new McpConfigError("server must be an object");
  }
  const serverName = requiredString(value.serverName, "serverName", 32);
  if (!SERVER_NAME.test(serverName)) {
    throw new McpConfigError("serverName may contain only letters, numbers, underscores, and hyphens");
  }
  const enabled = value.enabled !== false;
  if (value.transport === "streamable-http") {
    const url = requiredString(value.url, "url");
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new McpConfigError("url must be valid");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new McpConfigError("url must use http or https");
    }
    return {
      serverName,
      enabled,
      transport: "streamable-http",
      url: parsed.toString(),
      headers: stringRecord(value.headers, "headers"),
    };
  }
  if (value.transport === "stdio") {
    return {
      serverName,
      enabled,
      transport: "stdio",
      command: requiredString(value.command, "command", 1024),
      args: stringArray(value.args, "args"),
      env: stringRecord(value.env, "env"),
      cwd: typeof value.cwd === "string" ? value.cwd.trim() : "",
    };
  }
  throw new McpConfigError("transport must be streamable-http or stdio");
}

export function loadMcpServers(dataDir) {
  const path = mcpConfigPath(dataDir);
  if (!existsSync(path)) return [];
  let document;
  try {
    document = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`invalid MCP configuration: ${path}`);
  }
  if (!document || document.version !== 1 || !Array.isArray(document.servers)) {
    throw new Error(`invalid MCP configuration: ${path}`);
  }
  if (document.servers.length > MAX_SERVERS) {
    throw new Error(`MCP configuration exceeds ${MAX_SERVERS} servers`);
  }
  const servers = document.servers.map(normalizeMcpServer);
  const names = new Set();
  for (const server of servers) {
    if (names.has(server.serverName)) {
      throw new Error(`duplicate MCP serverName: ${server.serverName}`);
    }
    names.add(server.serverName);
  }
  return servers;
}

export function saveMcpServers(dataDir, servers) {
  if (!Array.isArray(servers) || servers.length > MAX_SERVERS) {
    throw new McpConfigError(`servers must contain at most ${MAX_SERVERS} entries`);
  }
  const normalized = servers.map(normalizeMcpServer);
  const names = new Set();
  for (const server of normalized) {
    if (names.has(server.serverName)) {
      throw new McpConfigError(`duplicate serverName: ${server.serverName}`);
    }
    names.add(server.serverName);
  }
  writeJsonFile(mcpConfigPath(dataDir), { version: 1, servers: normalized });
  return normalized;
}
