import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createProducedGateBudget,
  durablePathFromToolCall,
  durableProducedPathsFromEvents,
  findUnopenableProducedPaths,
  parseToolArguments,
  unpublishedMediaPathsFromEvents,
  unpublishedMediaSteerText,
  producedGateSteerText,
} from "../../packages/core/files/produced-gate.js";

test("durablePathFromToolCall keeps media fetches and write/edit, drops research json", () => {
  assert.equal(
    durablePathFromToolCall("url_fetch", { destination: "downloads/photo.jpg" }),
    "downloads/photo.jpg",
  );
  assert.equal(
    durablePathFromToolCall("url_fetch", { destination: "downloads/jellyfin-list.json" }),
    null,
  );
  assert.equal(
    durablePathFromToolCall("drive_fetch", { destination: "downloads/clip.webm" }),
    "downloads/clip.webm",
  );
  assert.equal(
    durablePathFromToolCall("drive_fetch", { destination: "downloads/notes.md" }),
    null,
  );
  assert.equal(durablePathFromToolCall("write", { file_path: "plex/Chart.yaml" }), "plex/Chart.yaml");
  assert.equal(
    durablePathFromToolCall("workspace_publish", { path: "plex/OlaresManifest.yaml" }),
    "plex/OlaresManifest.yaml",
  );
});

test("durableProducedPathsFromEvents keeps successful durable paths only", () => {
  const events = [
    {
      type: "tool/call",
      data: {
        turn: 1,
        callId: "a",
        name: "url_fetch",
        arguments: JSON.stringify({ destination: "downloads/jellyfin-list.json" }),
      },
    },
    {
      type: "tool/result",
      data: {
        turn: 1,
        message: {
          source: { callId: "a" },
          content: [{ type: "tool-result", isError: false }],
        },
      },
    },
    {
      type: "tool/call",
      data: {
        turn: 1,
        callId: "b",
        name: "write",
        arguments: { file_path: "plex/Chart.yaml", content: "x" },
      },
    },
    {
      type: "tool/result",
      data: {
        turn: 1,
        message: {
          source: { callId: "b" },
          content: [{ type: "tool-result", isError: false }],
        },
      },
    },
    {
      type: "tool/call",
      data: {
        turn: 1,
        callId: "c",
        name: "url_fetch",
        arguments: JSON.stringify({ destination: "downloads/cover.png" }),
      },
    },
    {
      type: "tool/result",
      data: {
        turn: 1,
        message: {
          source: { callId: "c" },
          content: [{ type: "tool-result", isError: true }],
        },
      },
    },
  ];
  assert.deepEqual(durableProducedPathsFromEvents(events, 1), ["plex/Chart.yaml"]);
  assert.equal(parseToolArguments("{"), null);
});

test("findUnopenableProducedPaths reports missing durable files", async () => {
  const root = mkdtempSync(join(tmpdir(), "lares-produced-gate-"));
  try {
    mkdirSync(join(root, "plex"));
    writeFileSync(join(root, "plex", "Chart.yaml"), "apiVersion: v2\n");
    assert.deepEqual(
      await findUnopenableProducedPaths(root, ["plex/Chart.yaml", "plex/missing.yaml"]),
      ["plex/missing.yaml"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generation files_path must be published before the turn closes", () => {
  const video = "drive/Data/flowstudio/userData/alice/outputs/video/result.mp4";
  const events: any[] = [
    {
      type: "tool/call",
      data: {
        turn: 3,
        callId: "poll",
        name: "bash",
        arguments: { command: "curl /generations/id" },
      },
    },
    {
      type: "tool/result",
      data: {
        turn: 3,
        message: {
          source: { callId: "poll" },
          content: [{
            type: "tool-result",
            isError: false,
            content: [{
              type: "text",
              text: JSON.stringify({
                status: "completed",
                outputs: [
                  { files_path: video },
                  { files_path: "drive/Data/flowstudio/metadata.json" },
                ],
              }),
            }],
          }],
        },
      },
    },
  ];

  assert.deepEqual(unpublishedMediaPathsFromEvents(events, 3), [video]);
  assert.match(unpublishedMediaSteerText([video]), /workspace_publish/);

  events.push(
    {
      type: "tool/call",
      data: {
        turn: 3,
        callId: "publish",
        name: "workspace_publish",
        arguments: { path: video },
      },
    },
    {
      type: "tool/result",
      data: {
        turn: 3,
        message: {
          source: { callId: "publish" },
          content: [{ type: "tool-result", isError: false }],
        },
      },
    },
  );
  assert.deepEqual(unpublishedMediaPathsFromEvents(events, 3), []);
});

test("failed and non-JSON tool results do not invent unpublished media", () => {
  const result = (callId: string, isError: boolean, text: string) => ({
    type: "tool/result",
    data: {
      turn: 5,
      message: {
        source: { callId },
        content: [{
          type: "tool-result",
          isError,
          content: [{ type: "text", text }],
        }],
      },
    },
  });
  assert.deepEqual(unpublishedMediaPathsFromEvents([
    result("failed", true, '{"files_path":"drive/Data/failed.mp4"}'),
    result("prose", false, "video saved somewhere else"),
    result("queued", false, '{"status":"in_progress","outputs":[{"files_path":"drive/Data/early.mp4"}]}'),
    result("untrusted", false, '{"status":"completed","files_path":"https://example.com/out.mp4"}'),
    result("workspace", false, '{"status":"completed","files_path":"outputs/not-a-files-address.mp4"}'),
  ], 5), []);
});

test("turn stopping never probes Olares Files without a browser request", async () => {
  let probed = false;
  assert.deepEqual(
    await findUnopenableProducedPaths("/unused", ["drive/Home/Downloads/clip.webm"], {
      statFilesFile: async () => {
        probed = true;
        throw new Error("must not run");
      },
    }),
    [],
  );
  assert.equal(probed, false);
});

test("produced gate budget caps steers per turn", () => {
  const budget = createProducedGateBudget(2);
  assert.equal(budget.consume("a", 1), true);
  assert.equal(budget.consume("a", 1), true);
  assert.equal(budget.consume("a", 1), false);
  assert.equal(budget.remaining("a", 1), 0);
  assert.match(producedGateSteerText(["plex/Chart.yaml"]), /plex\/Chart\.yaml/);
});
