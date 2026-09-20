import { fileName } from "./filename.js";

/** Strip mention wrappers (`code`, @path) so a chip can match a produced path. */
export function mentionText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().replace(/^@/, "").replace(/^`+|`+$/g, "");
}

/**
 * True when the visible label is only a produced path (or its leaf). Used to
 * hide the in-message chip that duplicates the turn-tail preview.
 */
export function isDuplicateProducedMention(text, paths) {
  const bare = mentionText(text);
  if (!bare || !Array.isArray(paths) || paths.length === 0) return false;
  return paths.some((path) => {
    const produced = mentionText(path);
    return produced !== "" && (bare === produced || bare === fileName(produced));
  });
}
