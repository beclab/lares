import { stat } from "node:fs/promises";
import { isFilesPath } from "../drive/files-path.js";
import {
  durablePathFromToolCall,
  parseToolArguments,
  toolResultIsError,
} from "./published-tools.js";
import { isMediaDeliverablePath } from "./preview-groups.js";
import {
  resolveExistingWorkspacePath,
  resolveWorkspaceRoot,
  workspaceCandidate,
} from "../workspace/path.js";

export const PRODUCED_GATE_PLUGIN = "lares-produced-gate";
export const MAX_PRODUCED_GATE_STEERS = 2;

export { durablePathFromToolCall, parseToolArguments } from "./published-tools.js";

/**
 * Successful mutation paths for one turn, in tool order, deduped.
 * @param {Iterable<{ type?: string, data?: any }>} events
 */
export function durableProducedPathsFromEvents(events, turn) {
  const pending = new Map();
  const paths = [];
  const seen = new Set();
  for (const event of events) {
    if (event?.data?.turn !== turn) continue;
    if (event.type === "tool/call") {
      const callId = String(event.data.callId ?? "");
      const name = String(event.data.name ?? "");
      const path = durablePathFromToolCall(name, parseToolArguments(event.data.arguments));
      if (callId && path) pending.set(callId, path);
      continue;
    }
    if (event.type !== "tool/result") continue;
    if (toolResultIsError(event)) continue;
    const callId = String(event.data?.message?.source?.callId ?? "");
    const path = pending.get(callId);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

function resultTexts(value, texts = []) {
  if (Array.isArray(value)) {
    for (const item of value) resultTexts(item, texts);
    return texts;
  }
  if (!value || typeof value !== "object") return texts;
  if (typeof value.text === "string") texts.push(value.text);
  if ("content" in value) resultTexts(value.content, texts);
  return texts;
}

function parseResultJson(text) {
  const source = String(text ?? "").trim();
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(source.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function collectFilesPaths(value, paths) {
  if (Array.isArray(value)) {
    for (const item of value) collectFilesPaths(item, paths);
    return;
  }
  if (!value || typeof value !== "object") return;
  const status = typeof value.status === "string" ? value.status.toLowerCase() : "";
  if ([
    "queued", "pending", "submitted", "starting", "processing", "in_progress", "running",
    "failed", "error", "canceled", "cancelled",
  ].includes(status)) {
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if ((key === "files_path" || key === "filesPath") && typeof item === "string") {
      const path = item.trim().replace(/\\/g, "/");
      if (isFilesPath(path) && isMediaDeliverablePath(path)) paths.push(path);
      continue;
    }
    collectFilesPaths(item, paths);
  }
}

/**
 * Generation is performed through bash/curl, so dsh has no native artifact
 * event for its result. Recover media addresses from successful tool output and
 * require the agent to declare each one through workspace_publish.
 */
export function unpublishedMediaPathsFromEvents(events, turn) {
  const published = new Set(durableProducedPathsFromEvents(events, turn));
  const paths = [];
  const seen = new Set();
  for (const event of events) {
    if (event?.type !== "tool/result" || event?.data?.turn !== turn) continue;
    if (toolResultIsError(event)) continue;
    for (const text of resultTexts(event.data?.message?.content)) {
      const parsed = parseResultJson(text);
      if (parsed === null) continue;
      const found = [];
      collectFilesPaths(parsed, found);
      for (const path of found) {
        if (published.has(path) || seen.has(path)) continue;
        seen.add(path);
        paths.push(path);
      }
    }
  }
  return paths;
}

export function unpublishedMediaSteerText(paths) {
  const list = paths.map((path) => `- \`${path}\``).join("\n");
  return [
    "A completed media generation returned files that are not published to this turn:",
    list,
    "Call workspace_publish once for each exact files_path above before replying.",
    "Do not regenerate, download, or copy these files; they already exist in Olares Files.",
    "Only claim that the preview is available after workspace_publish succeeds.",
  ].join("\n");
}

async function pathIsOpenable(workspaceRoot, path, deps = {}) {
  // Olares Files requires the browser credential carried by an interactive
  // preview request. A background turn-stopping hook must not reuse the last
  // process-global CLI identity or block a turn because that token expired.
  if (isFilesPath(path)) return true;
  try {
    const root = await (deps.resolveWorkspaceRoot ?? resolveWorkspaceRoot)(workspaceRoot);
    const absolute = await (deps.resolveExistingWorkspacePath ?? resolveExistingWorkspacePath)(
      root,
      workspaceCandidate(root, path),
    );
    const info = await (deps.stat ?? stat)(absolute);
    return info.isFile();
  } catch {
    return false;
  }
}

/**
 * @returns {Promise<string[]>} paths that cannot be opened for preview.
 */
export async function findUnopenableProducedPaths(workspaceRoot, paths, deps = {}) {
  const missing = [];
  for (const path of paths) {
    if (!(await pathIsOpenable(workspaceRoot, path, deps))) missing.push(path);
  }
  return missing;
}

export function producedGateSteerText(missing) {
  const list = missing.map((path) => `- \`${path}\``).join("\n");
  return [
    "Produced-file openability check failed before this turn could close.",
    "These paths were offered as deliverables but cannot be opened right now:",
    list,
    "Restore or rewrite each file at that exact path, or workspace_publish a",
    "replacement path and name only openable finals in your reply.",
    "Do not claim a file is ready until it opens. Research fetches under",
    "downloads/ (git/API JSON, chart YAML, READMEs) are scratch — delete them",
    "freely, but keep image / video / audio / 3D media and final write/edit outputs.",
  ].join("\n");
}

/**
 * Per-agent turn budget so a stuck restore cannot loop forever.
 */
export function createProducedGateBudget(max = MAX_PRODUCED_GATE_STEERS) {
  const attempts = new Map();
  return {
    remaining(agentId, turn) {
      const key = `${agentId}:${turn}`;
      return Math.max(0, max - (attempts.get(key) ?? 0));
    },
    consume(agentId, turn) {
      const key = `${agentId}:${turn}`;
      const next = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, next);
      return next <= max;
    },
  };
}
