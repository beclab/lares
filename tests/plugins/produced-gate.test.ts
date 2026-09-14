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

test("produced gate budget caps steers per turn", () => {
  const budget = createProducedGateBudget(2);
  assert.equal(budget.consume("a", 1), true);
  assert.equal(budget.consume("a", 1), true);
  assert.equal(budget.consume("a", 1), false);
  assert.equal(budget.remaining("a", 1), 0);
  assert.match(producedGateSteerText(["plex/Chart.yaml"]), /plex\/Chart\.yaml/);
});
