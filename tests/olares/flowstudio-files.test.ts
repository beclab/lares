import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { runOlaresCat } from "@olares/lares-core/drive/cat";
import {
  attachFlowstudioFilesPaths,
  flowstudioOutputPointerPath,
  parseFlowstudioFilesPointer,
  resolveFlowstudioFilesPath,
} from "@olares/lares-core/drive/flowstudio-files";

function fakeChild(exit: { code?: number; stdout?: string; stderr?: string; error?: Error }) {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    if (exit.error) {
      child.emit("error", exit.error);
      return;
    }
    if (exit.stdout) child.stdout.emit("data", Buffer.from(exit.stdout));
    if (exit.stderr) child.stderr.emit("data", Buffer.from(exit.stderr));
    child.emit("close", exit.code ?? 0);
  });
  return child;
}

test("flowstudio pointer path is keyed by owner and output id", () => {
  assert.equal(
    flowstudioOutputPointerPath("alice", "11111111-1111-1111-1111-111111111111"),
    "drive/Data/flowstudio/userData/alice/comfyui/outputs/.by-id/11111111-1111-1111-1111-111111111111",
  );
  assert.equal(flowstudioOutputPointerPath("alice/../bob", "id"), null);
  assert.equal(flowstudioOutputPointerPath("alice", "../id"), null);
  assert.equal(flowstudioOutputPointerPath("", "id"), null);
});

test("pointer text must be a FlowStudio files address", () => {
  assert.equal(
    parseFlowstudioFilesPointer(
      "drive/Data/flowstudio/userData/alice/comfyui/outputs/image/a.delivery.webp\n",
    ),
    "drive/Data/flowstudio/userData/alice/comfyui/outputs/image/a.delivery.webp",
  );
  assert.equal(parseFlowstudioFilesPointer("drive/Home/a.webp"), null);
  assert.equal(parseFlowstudioFilesPointer("drive/Data/flowstudio/userData/../etc/passwd"), null);
});

test("runOlaresCat asks the CLI for the file text", async () => {
  let call: { command: string; args: string[] } | null = null;
  const text = await runOlaresCat(
    "drive/Data/flowstudio/userData/alice/comfyui/outputs/.by-id/abc",
    {
      spawnFn: (command: string, args: string[]) => {
        call = { command, args };
        return fakeChild({
          code: 0,
          stdout: "drive/Data/flowstudio/userData/alice/comfyui/outputs/image/a.webp\n",
        });
      },
    },
  );
  assert.deepEqual(call, {
    command: "olares-cli",
    args: ["files", "cat", "drive/Data/flowstudio/userData/alice/comfyui/outputs/.by-id/abc"],
  });
  assert.match(text, /a\.webp/);
});

test("attachFlowstudioFilesPaths fills completed outputs from the pointer", async () => {
  const outputId = "22222222-2222-2222-2222-222222222222";
  const filesPath = "drive/Data/flowstudio/userData/alice/comfyui/outputs/image/a.delivery.webp";
  const view = await attachFlowstudioFilesPaths(
    {
      id: "router-gen",
      status: "completed",
      outputs: [{ id: outputId, content_url: "/v1/generations/router-gen/content" }],
    },
    "alice",
    {
      cat: async (path: string) => {
        assert.equal(
          path,
          `drive/Data/flowstudio/userData/alice/comfyui/outputs/.by-id/${outputId}`,
        );
        return `${filesPath}\n`;
      },
    },
  );
  assert.equal(view.outputs[0].files_path, filesPath);
});

test("attachFlowstudioFilesPaths reads the outputs Router nests under response", async () => {
  const outputId = "33333333-3333-3333-3333-333333333333";
  const filesPath = "drive/Data/flowstudio/userData/alice/comfyui/outputs/image/b.delivery.webp";
  const view = await attachFlowstudioFilesPaths(
    {
      id: "router-gen",
      media_type: "image",
      status: "completed",
      response: {
        object: "flowstudio.generation",
        status: "completed",
        outputs: [{ id: outputId }],
      },
    },
    "alice",
    { cat: async () => `${filesPath}\n` },
  );
  assert.equal(view.outputs[0].id, outputId);
  assert.equal(view.outputs[0].files_path, filesPath);
});

test("attachFlowstudioFilesPaths trusts the address Router already sent", async () => {
  const filesPath = "drive/Data/flowstudio/userData/alice/comfyui/outputs/image/c.png";
  const view = await attachFlowstudioFilesPaths(
    {
      status: "completed",
      outputs: [{ id: "44444444-4444-4444-4444-444444444444", files_path: filesPath }],
    },
    "alice",
    { cat: async () => { throw new Error("the wire already answered this"); } },
  );
  assert.equal(view.outputs[0].files_path, filesPath);
});

// FlowStudio serializes camelCase. Its snapshot reaches here unreshaped when
// Router nests it, and a caller reading `files_path` must not miss an address
// that arrived spelled the other way.
test("attachFlowstudioFilesPaths normalizes a camelCase address", async () => {
  const filesPath = "drive/Data/flowstudio/userData/alice/comfyui/outputs/image/d.png";
  const view = await attachFlowstudioFilesPaths(
    { status: "completed", outputs: [{ id: "output-1", filesPath }] },
    "alice",
    { cat: async () => { throw new Error("the wire already answered this"); } },
  );
  assert.equal(view.outputs[0].files_path, filesPath);
});

// Hoisting is not conditional on having something to add: nested outputs that
// already carry their address still have to reach the level callers read.
test("attachFlowstudioFilesPaths hoists nested outputs it did not change", async () => {
  const filesPath = "drive/Data/flowstudio/userData/alice/comfyui/outputs/image/e.png";
  const view = await attachFlowstudioFilesPaths(
    {
      status: "completed",
      response: { status: "completed", outputs: [{ id: "output-1", files_path: filesPath }] },
    },
    "alice",
    { cat: async () => { throw new Error("the wire already answered this"); } },
  );
  assert.equal(view.outputs[0].files_path, filesPath);
});

test("attachFlowstudioFilesPaths leaves in-progress and failed lookups unchanged", async () => {
  const queued = await attachFlowstudioFilesPaths(
    { status: "in_progress", outputs: [{ id: "x" }] },
    "alice",
    { cat: async () => { throw new Error("should not cat"); } },
  );
  assert.equal(queued.outputs[0].files_path, undefined);

  const missing = await attachFlowstudioFilesPaths(
    { status: "completed", outputs: [{ id: "x", content_url: "/content" }] },
    "alice",
    { cat: async () => { throw new Error("not found"); } },
  );
  assert.equal(missing.outputs[0].files_path, undefined);
  assert.equal(missing.outputs[0].content_url, "/content");
});

test("resolveFlowstudioFilesPath returns null when cat fails", async () => {
  assert.equal(
    await resolveFlowstudioFilesPath("alice", "id", {
      cat: async () => { throw new Error("gone"); },
    }),
    null,
  );
});
