import { isMediaDeliverablePath } from "./preview-groups.js";

export const LARES_PUBLISH_TOOLS = new Set([
  "drive_fetch",
  "ffmpeg_encode",
  "url_fetch",
  "workspace_publish",
]);

/**
 * Parse tool-call arguments from either the persisted JSON wire shape or the
 * in-process object used while a tool is executing.
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
 * User-facing path declared by one Lares artifact tool. Research downloads
 * are intentionally excluded; only media fetched into the workspace is a
 * durable deliverable.
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

/**
 * Every path one successful artifact tool call published. media_generate is
 * the one whose paths come from its result, since the outputs do not exist
 * until the generation finishes.
 */
export function publishedPathsFromToolCall(name, args, value) {
  if (name === "media_generate") {
    return Array.isArray(value?.files) ? value.files.filter((path) => typeof path === "string" && path) : [];
  }
  const path = durablePathFromToolCall(name, args);
  return path ? [path] : [];
}

export function toolResultIsError(event) {
  const content = event?.data?.message?.content;
  if (!Array.isArray(content) || content.length === 0) return true;
  return content.some((block) => block?.type === "tool-result" && block.isError === true);
}
