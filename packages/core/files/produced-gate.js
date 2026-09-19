import { stat } from "node:fs/promises";
import { isFilesPath } from "../drive/files-path.js";
import { isMediaDeliverablePath } from "./preview-groups.js";
import {
  resolveExistingWorkspacePath,
  resolveWorkspaceRoot,
  workspaceCandidate,
} from "../workspace/path.js";

export const PRODUCED_GATE_PLUGIN = "lares-produced-gate";
export const MAX_PRODUCED_GATE_STEERS = 2;

/**
 * Parse tool-call arguments that arrive as a JSON string or object.
 * @returns {Record<string, unknown> | null}
 */
export function parseToolArguments(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Paths this tool call would leave as user-facing Produced deliverables.
 * Research fetches (non-media under downloads/) are scratch and excluded.
 */
export function durablePathFromToolCall(name, args) {
  if (!args) return null;
  if (name === "write" || name === "edit") {
    const path = String(args.file_path ?? "").trim().replace(/\\/g, "/");
    return path || null;
  }
  if (name === "workspace_publish") {
    const path = String(args.path ?? "").trim().replace(/\\/g, "/");
    return path || null;
  }
  if (name === "url_fetch" || name === "drive_fetch") {
    const destination = String(args.destination ?? "").trim().replace(/\\/g, "/");
    if (!destination || !isMediaDeliverablePath(destination)) return null;
    return destination;
  }
  if (name === "ffmpeg_encode") {
    const destination = String(args.destination ?? "").trim().replace(/\\/g, "/");
    return destination || null;
  }
  return null;
}

function toolResultIsError(event) {
  const content = event?.data?.message?.content;
  if (!Array.isArray(content) || content.length === 0) return true;
  return content.some((block) => block?.type === "tool-result" && block.isError === true);
}

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
