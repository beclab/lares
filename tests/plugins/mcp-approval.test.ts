import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Context, Service } from "@deepseek-ai/cordis";
import { createScope, scopeOf } from "@deepseek-ai/dsh-scope";
import {
  bindMcpClientCapture,
  createMcpAnnotationIndex,
  decideMcpToolGate,
  mcpPublicToolName,
  mcpServerNameForTransport,
} from "@olares/lares-core/mcp/approval";
import { installMcpToolApproval } from "../../packages/web/mcp/host/approval.js";

const allow = { kind: "allow" as const };

test("MCP public names match the dsh bridge contract", () => {
  assert.equal(mcpPublicToolName("concat", "concat_status"), "mcp__concat__concat_status");
  const hash = createHash("sha256").update("concat\0list.files").digest("hex").slice(0, 12);
  assert.equal(mcpPublicToolName("concat", "list.files"), `mcp__concat__list_files_${hash}`);
  assert.equal(mcpPublicToolName("concat", "t".repeat(80)).length, 64);
});

test("full access runs MCP tools; restricted presets ask before a mutating call", () => {
  const readOnly = { readOnlyHint: true as const };
  const cases = [
    { name: "mcp__concat__concat_status", annotation: readOnly, sandboxMode: "read-only", kind: "allow" },
    { name: "mcp__concat__concat_begin_edit", annotation: {}, sandboxMode: "read-only", kind: "ask" },
    { name: "mcp__concat__concat_status", annotation: readOnly, sandboxMode: "workspace-write", kind: "allow" },
    { name: "mcp__concat__concat_begin_edit", annotation: {}, sandboxMode: "workspace-write", kind: "ask" },
    { name: "mcp__concat__concat_begin_edit", annotation: {}, sandboxMode: "danger-full-access", kind: "allow" },
    { name: "mcp__concat__concat_begin_edit", annotation: undefined, sandboxMode: "read-only", kind: "ask" },
    { name: "mcp__concat__concat_begin_edit", annotation: undefined, sandboxMode: "danger-full-access", kind: "allow" },
    { name: "write_file", annotation: {}, sandboxMode: "read-only", kind: "allow" },
  ];
  for (const item of cases) {
    assert.equal(decideMcpToolGate({ ...item, prior: allow }).kind, item.kind, item.name);
  }
  const denied = { kind: "deny" as const, reason: "blocked" };
  assert.equal(decideMcpToolGate({
    name: "mcp__concat__concat_begin_edit",
    annotation: {},
    sandboxMode: "read-only",
    prior: denied,
  }), denied);
});

test("a failed tool list does not replace annotations of the registered generation", () => {
  const index = createMcpAnnotationIndex();
  index.stage("concat", {
    first: true,
    tools: [{ name: "concat_status", annotations: { readOnlyHint: true } }],
  });
  index.commit("mcp__concat__concat_status");
  index.stage("concat", {
    first: true,
    tools: [{ name: "concat_begin_edit", annotations: { readOnlyHint: false } }],
  });
  assert.deepEqual(index.get("mcp__concat__concat_status"), { readOnlyHint: true });
  assert.equal(index.get("mcp__concat__concat_begin_edit"), undefined);
  index.commit("mcp__concat__concat_begin_edit");
  assert.deepEqual(index.get("mcp__concat__concat_begin_edit"), {});
  index.drop("concat");
  assert.equal(index.get("mcp__concat__concat_status"), undefined);
  assert.equal(index.get("mcp__concat__concat_begin_edit"), undefined);
});

test("tool-list capture follows the connected server and ignores other methods", async () => {
  const index = createMcpAnnotationIndex();
  const servers = [{
    serverName: "concat",
    enabled: true,
    transport: "streamable-http",
    url: "https://concat.example/mcp",
  }, {
    serverName: "idle",
    enabled: false,
    transport: "stdio",
    command: "concat-mcp",
    args: [],
    cwd: "",
  }];
  const proto: {
    connect: (transport: unknown) => Promise<void>;
    request: (req: { method: string }) => Promise<unknown>;
  } = {
    async connect() {},
    async request(req) {
      if (req.method === "tools/list") {
        return {
          tools: [
            { name: "concat_status", annotations: { readOnlyHint: true } },
            { name: "concat_begin_edit" },
          ],
        };
      }
      return { ok: true };
    },
  };
  bindMcpClientCapture(proto, { annotations: index, servers: () => servers });
  const client = {};
  await proto.connect.call(client, { _url: new URL("https://concat.example/mcp") });
  await proto.request.call(client, { method: "tools/call" });
  assert.equal(index.get("mcp__concat__concat_status"), undefined);
  await proto.request.call(client, { method: "tools/list" });
  index.commit("mcp__concat__concat_status");
  index.commit("mcp__concat__concat_begin_edit");
  assert.deepEqual(index.get("mcp__concat__concat_status"), { readOnlyHint: true });
  assert.deepEqual(index.get("mcp__concat__concat_begin_edit"), {});
  assert.equal(
    mcpServerNameForTransport({ _serverParams: { command: "concat-mcp", args: [], cwd: "" } }, servers),
    undefined,
  );
});

test("tool registration stays on the calling agent scope", async () => {
  class Tools extends Service {
    constructor(ctx: ConstructorParameters<typeof Service>[0]) {
      super(ctx, "tools");
      this.layers = new Map<unknown, Set<string>>();
    }

    layers: Map<unknown, Set<string>>;

    register(definition: { name: string }) {
      const scope = scopeOf(this.ctx);
      const key = scope ?? "global";
      const layer = this.layers.get(key) ?? new Set<string>();
      if (layer.has(definition.name)) {
        throw new Error(
          scope === undefined
            ? `tool "${definition.name}" is already registered (for a per-agent variant, register through that agent's \`agent.ctx\` instead)`
            : `tool "${definition.name}" is already registered in this scope`,
        );
      }
      layer.add(definition.name);
      this.layers.set(key, layer);
    }
  }

  let host: { tools: Tools };
  let annotations: ReturnType<typeof installMcpToolApproval>;
  class Host {
    static inject = ["tools"];

    constructor(ctx: { tools: Tools }) {
      host = ctx;
      annotations = installMcpToolApproval(ctx as never, () => []);
    }
  }

  const root = new Context();
  await root.plugin(Tools);
  await root.plugin(Host);
  annotations.stage("concat", {
    first: true,
    tools: [{ name: "concat_status", annotations: { readOnlyHint: true } }],
  });
  const first = createScope(host!, { id: "a" });
  const second = createScope(host!, { id: "b" });
  first.ctx.tools.register({ name: "subagent" });
  second.ctx.tools.register({ name: "subagent" });
  first.ctx.tools.register({ name: "mcp__concat__concat_status" });
  assert.equal(host!.tools.layers.has("global"), false);
  assert.equal(host!.tools.layers.size, 2);
  assert.deepEqual(annotations.get("mcp__concat__concat_status"), { readOnlyHint: true });
});
