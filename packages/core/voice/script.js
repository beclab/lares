import { segment } from "sentencex";

/**
 * Kokoro's pipeline splits on newlines and stitches the audio with no gap, and
 * it does not treat punctuation as a pause. Sentence boundaries come from
 * Wikimedia sentencex (English abbreviations, decimals, ellipsis). The gap
 * matches Kokoro-FastAPI's sentence padding: 150ms, doubled for . ! ?
 */
export const SENTENCE_GAP_MS = 300;

/** Text still streaming may hold a code fence that has not closed yet. */
function closedPart(text) {
  const fences = text.match(/```/g)?.length ?? 0;
  return fences % 2 === 0 ? text : text.slice(0, text.lastIndexOf("```"));
}

/** Table rules and horizontal rules carry nothing to read. */
const RULE_LINE = /^\s*(?:\|?\s*:?-{3,}:?\s*)+\|?\s*$|^\s*([-*_])(?:\s*\1){2,}\s*$/;
const BLOCK_MARK = /^\s*(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]]\s+)?|\d+[.)]\s+)?/;

function plainLine(line) {
  if (RULE_LINE.test(line)) return "";
  return line
    .replace(BLOCK_MARK, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[|#>*_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Model answers are Markdown, and a heading, list item or table row often ends
 * without punctuation, so every line is a sentence boundary of its own.
 */
function plainLines(text) {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .slice(0, 2000)
    .split("\n")
    .map(plainLine);
}

function sentencesOf(line) {
  return line ? segment("en", line).map((part) => part.trim()).filter(Boolean) : [];
}

/**
 * Synthesis time grows with the segment, and the first sound waits for the
 * whole first segment. A long sentence is read clause by clause instead,
 * clauses merged back up to this length. A CJK character counts as one, other
 * characters as a third (roughly a syllable each way).
 */
const MAX_SEGMENT_WEIGHT = 24;
const CJK = /[\u3000-\u9fff\uff00-\uffef]/g;
// ASCII separators only when a space follows, so 1,000 and 10:30 stay whole.
const CLAUSE_SPLIT = /(?<=[，；：]|[,;:](?=\s))/;
const CLAUSE_END = /[，,；;：:]$/;

function weight(text) {
  const cjk = text.match(CJK)?.length ?? 0;
  return cjk + (text.length - cjk) / 3;
}

function joinClauses(left, right) {
  return /[\u3000-\u9fff\uff00-\uffef]$/.test(left) ? `${left}${right}` : `${left} ${right}`;
}

function clauses(sentence) {
  if (weight(sentence) <= MAX_SEGMENT_WEIGHT) return [sentence];
  const merged = [];
  for (const part of sentence.split(CLAUSE_SPLIT).map((piece) => piece.trim()).filter(Boolean)) {
    const last = merged.at(-1);
    if (last !== undefined && weight(joinClauses(last, part)) <= MAX_SEGMENT_WEIGHT) {
      merged[merged.length - 1] = joinClauses(last, part);
    } else {
      merged.push(part);
    }
  }
  return merged;
}

/** A clause break is half a sentence break. */
export function gapAfter(segment) {
  return CLAUSE_END.test(segment) ? SENTENCE_GAP_MS / 2 : SENTENCE_GAP_MS;
}

/**
 * The segments to read: sentences, long ones cut into clauses. While the
 * answer is still streaming (`done: false`) its open line may be cut
 * mid-word, so only the sentences before its last one count.
 * @returns {string[]}
 */
export function speechSegments(text, { done = true } = {}) {
  const lines = plainLines(done ? text : closedPart(String(text ?? "")));
  const open = done ? "" : lines.pop();
  const sentences = lines.flatMap(sentencesOf);
  sentences.push(...sentencesOf(open).slice(0, -1));
  return sentences.flatMap(clauses);
}

export function speechScript(text) {
  return speechSegments(text).join("\n");
}
