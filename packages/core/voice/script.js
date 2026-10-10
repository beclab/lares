import { segment } from "sentencex";

/**
 * Kokoro's pipeline splits on newlines and stitches the audio with no gap, and
 * it does not treat punctuation as a pause. Sentence boundaries come from
 * Wikimedia sentencex (English abbreviations, decimals, ellipsis). The gap
 * matches Kokoro-FastAPI's sentence padding: 150ms, doubled for . ! ?
 */
export const SENTENCE_GAP_MS = 300;

function plain(text) {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[#>*_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

export function speechSegments(text) {
  const source = plain(text);
  if (!source) return [];
  const sentences = segment("en", source).map((part) => part.trim()).filter(Boolean);
  return sentences.map((sentence, index) => ({
    text: sentence,
    gapMs: index === sentences.length - 1 ? 0 : SENTENCE_GAP_MS,
  }));
}

export function speechScript(text) {
  return speechSegments(text).map((part) => part.text).join("\n");
}
