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
 * Router forwards `outputs[].id` (that UUID) but not `files_path`.
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
 * On a completed generation view, fill each output's `files_path` from the
 * Files pointer named by `output.id`. Missing pointers stay unchanged.
 */
export async function attachFlowstudioFilesPaths(payload, owner, options = {}) {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  if (String(payload.status ?? "").toLowerCase() !== "completed") return payload;
  const outputs = Array.isArray(payload.outputs) ? payload.outputs : [];
  if (outputs.length === 0) return payload;
  let changed = false;
  const next = [];
  for (const output of outputs) {
    if (output == null || typeof output !== "object" || Array.isArray(output)) {
      next.push(output);
      continue;
    }
    const existing = String(output.files_path ?? output.filesPath ?? "").trim();
    if (existing) {
      next.push(output);
      continue;
    }
    const path = await resolveFlowstudioFilesPath(owner, output.id, options);
    if (!path) {
      next.push(output);
      continue;
    }
    changed = true;
    next.push({ ...output, files_path: path });
  }
  return changed ? { ...payload, outputs: next } : payload;
}
