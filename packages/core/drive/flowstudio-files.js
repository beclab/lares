import { runOlaresCat } from "./cat.js";

/** Files-backend prefix of FlowStudio appData userData. */
export const FLOWSTUDIO_FILES_PREFIX = "drive/Data/flowstudio/userData";

function safeSegment(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "." || text === "..") return "";
  if (/[\\/\0]/.test(text)) return "";
  return text;
}

/**
 * Files address of the one-line pointer FlowStudio writes per JobOutput id.
 * Only needed behind a Router old enough to drop `files_path`; it still
 * forwards `outputs[].id`, which is that UUID.
 */
export function flowstudioOutputPointerPath(owner, outputId) {
  const user = safeSegment(owner);
  const id = safeSegment(outputId);
  if (!user || !id) return null;
  return `${FLOWSTUDIO_FILES_PREFIX}/${user}/comfyui/outputs/.by-id/${id}`;
}

/** First line of a pointer file must be the stored artifact's Files address. */
export function parseFlowstudioFilesPointer(text) {
  const line = String(text ?? "").trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!line.startsWith(`${FLOWSTUDIO_FILES_PREFIX}/`)) return null;
  if (line.includes("..") || line.includes("\\") || line.includes("\0")) return null;
  return line;
}

export async function resolveFlowstudioFilesPath(owner, outputId, options = {}) {
  const pointer = flowstudioOutputPointerPath(owner, outputId);
  if (!pointer) return null;
  try {
    const text = await (options.cat ?? runOlaresCat)(pointer, options);
    return parseFlowstudioFilesPointer(text);
  } catch {
    return null;
  }
}

/**
 * Publish a completed generation's outputs at the top level with a
 * `files_path` on each, which is the shape callers read.
 *
 * A current Router carries the address on the wire and there is nothing to
 * resolve. An older one drops it, and the address is then recovered from the
 * Files pointer named by `output.id`; an output with neither is published
 * unchanged rather than held back, since `content_url` still fetches it.
 *
 * Hoisting is the other half. Router nests the FlowStudio adapter's untouched
 * snapshot under `response`, so a FlowStudio job can list its outputs there
 * instead, and those outputs have to reach the top level whether or not this
 * function had anything to add to them.
 */
export async function attachFlowstudioFilesPaths(payload, owner, options = {}) {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  if (String(payload.status ?? "").toLowerCase() !== "completed") return payload;
  const hoisted = !Array.isArray(payload.outputs);
  const outputs = hoisted
    ? (Array.isArray(payload.response?.outputs) ? payload.response.outputs : [])
    : payload.outputs;
  if (outputs.length === 0) return payload;
  let changed = false;
  const next = [];
  for (const output of outputs) {
    if (output == null || typeof output !== "object" || Array.isArray(output)) {
      next.push(output);
      continue;
    }
    // FlowStudio serializes camelCase and Router relays snake_case, so an
    // address can arrive under either name; callers read only the one.
    const onWire = String(output.files_path ?? output.filesPath ?? "").trim();
    const path = onWire || (await resolveFlowstudioFilesPath(owner, output.id, options));
    if (!path || path === output.files_path) {
      next.push(output);
      continue;
    }
    changed = true;
    next.push({ ...output, files_path: path });
  }
  return changed || hoisted ? { ...payload, outputs: next } : payload;
}
