import { textFromBlocks } from "./transcript.js";

function previewOf(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function textOf(row) {
  if (row.text === null) return null;
  if (typeof row.text === "string") return row.text;
  const content = Array.isArray(row.content) ? row.content : [];
  const text = textFromBlocks(content);
  if (text) return text;
  return content.some((block) => block?.type && block.type !== "text") ? null : "";
}

/**
 * Host queue rows carry `content` plus optional `preview`/`text`. The dock
 * edits only a single text block; image-only rows stay non-editable.
 */
export function normalizeQueueItems(items) {
  return (Array.isArray(items) ? items : []).flatMap((row) => {
    if (!row || typeof row.id !== "string" || !row.id) return [];
    const content = Array.isArray(row.content) ? row.content : [];
    const text = textOf(row);
    return [{
      id: row.id,
      placement: row.placement === "queued" ? "queued" : String(row.placement || "queued"),
      content,
      text,
      preview: typeof row.preview === "string" && row.preview ? row.preview : previewOf(text),
    }];
  });
}
