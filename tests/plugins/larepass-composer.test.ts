import assert from "node:assert/strict";
import test from "node:test";
import { summarizeSession } from "@olares/lares-core/larepass/chat";
import { applyCommand, commandLine, commandsUrl, normalizeCommands } from "@olares/lares-core/larepass/commands";
import { consumeMux } from "@olares/lares-core/larepass/mux";
import {
  permissionLine,
  permissionOption,
  permissionSelect,
  presetDescription,
  presetLabel,
} from "@olares/lares-core/larepass/permissions";
import { createChatRuntime } from "@olares/lares-core/larepass/runtime";
import { EN } from "@olares/lares-core/i18n/mobile";

const t = (key: string) => EN[key] ?? key;

const SELECT = {
  options: [
    { value: "read-only", name: "read-only", description: "host copy" },
    { value: "workspace-write", name: "workspace-write" },
    { value: "custom-lab", name: "custom-lab", description: "lab only" },
  ],
  currentValue: "workspace-write",
};

test("the permission chip reads the host projection and localizes its kebab keys", () => {
  assert.equal(permissionSelect({}), null);
  assert.equal(permissionSelect({ projections: { values: { permissions: { options: [] } } } }), null);

  const select = permissionSelect({ projections: { values: { permissions: SELECT } } });
  assert.equal(select.currentValue, "workspace-write");
  assert.equal(select.options.length, 3);

  assert.equal(presetLabel(t, permissionOption(select)), "Workspace Write");
  assert.equal(presetDescription(t, permissionOption(select)), EN["permission.workspace-write.hint"]);
  // A preset this client has never heard of still reads as words, and keeps the
  // host's own description.
  const lab = permissionOption(select, "custom-lab");
  assert.equal(presetLabel(t, lab), "Custom Lab");
  assert.equal(presetDescription(t, lab), "lab only");
  assert.equal(presetLabel(t, null), "");
  assert.equal(permissionLine("read-only"), "/permission read-only");
});

test("a session summary carries its permission projection to the composer", () => {
  const row = summarizeSession({ sessionId: "s1", updatedAt: 3, projections: { values: { permissions: SELECT } } });
  assert.equal(row.permissions.currentValue, "workspace-write");
  assert.ok(!("permissions" in summarizeSession({ sessionId: "s2", updatedAt: 1 })));
});

test("command rows are normalized and land on the composer as one line", () => {
  assert.deepEqual(
    normalizeCommands({
      commands: [
        { name: " compact ", description: "Compact older conversation history" },
        { name: "goal", input: { hint: "<text>" } },
        { description: "no name" },
      ],
    }),
    [
      { name: "compact", description: "Compact older conversation history", hint: "" },
      { name: "goal", description: "", hint: "<text>" },
    ],
  );
  assert.deepEqual(normalizeCommands(undefined), []);
  assert.equal(commandsUrl("a b"), "/api/lares/commands?sessionId=a%20b");
  assert.equal(commandsUrl(""), "/api/lares/commands");

  const goal = { name: "goal", description: "", hint: "<text>" };
  assert.equal(commandLine(goal), "/goal ");
  assert.equal(applyCommand("", goal), "/goal ");
  assert.equal(applyCommand("ship the docs", goal), "/goal ship the docs");
  // Switching commands keeps whatever input was already typed for the old one.
  assert.equal(applyCommand("/plan ship the docs", goal), "/goal ship the docs");
  assert.equal(applyCommand("/plan", { name: "compact", description: "", hint: "" }), "/compact");
});

function permissionClient() {
  const prompts: string[] = [];
  let current = "workspace-write";
  return {
    prompts,
    probe: async () => ({ status: "ok", http: 200 }),
    ensureSession: async () => ({ ok: true, value: { sessionId: "s1" } }),
    rpc: async (method: string) => {
      if (method === "session.list") {
        return {
          ok: true,
          value: {
            items: [{
              sessionId: "s1",
              title: "s1",
              updatedAt: 5,
              projections: { values: { ...SELECT, currentValue: current } },
            }],
          },
        };
      }
      if (method === "session.history") {
        return {
          ok: true,
          value: { events: [], projections: { values: { permissions: { ...SELECT, currentValue: current } } } },
        };
      }
      throw new Error(method);
    },
    prompt: async (_sessionId: string, text: string) => {
      prompts.push(text);
      if (text.startsWith("/permission ")) current = text.slice("/permission ".length);
      return { ok: true, value: { accepted: true } };
    },
    openMux: async () => ({ ok: true, http: 200, body: new ReadableStream({ start: () => {} }) }),
    consumeMux,
    commands: async () => [{ name: "compact", description: "Compact older conversation history", hint: "" }],
  };
}

test("switching the preset goes out as the host's own command and shows at once", async () => {
  const client = permissionClient();
  const runtime = createChatRuntime(client);
  await runtime.start();
  assert.equal(runtime.snapshot().permissions.currentValue, "workspace-write");

  const switched = await runtime.setPermission("read-only");
  assert.ok(switched.ok);
  assert.deepEqual(client.prompts, ["/permission read-only"]);
  assert.equal(runtime.snapshot().permissions.currentValue, "read-only");

  assert.deepEqual(await runtime.listCommands(), [
    { name: "compact", description: "Compact older conversation history", hint: "" },
  ]);
  runtime.dispose();
});
