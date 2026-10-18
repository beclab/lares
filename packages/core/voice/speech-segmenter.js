import { segment } from "sentencex";
import { spokenBlocks } from "./spoken-text.js";

const LIMIT = 80, TARGET = 40;
export const LIST_WAIT_MS = 250;
const pairs = new Map([["（", "）"], ["(", ")"], ["[", "]"], ["【", "】"], ["{", "}"], ["“", "”"], ["‘", "’"], ["「", "」"], ["『", "』"]]);
const weight = text => [...text].reduce((n, c) => n + (/\p{Script=Han}|[\u3000-\u303f\uff00-\uffef]/u.test(c) ? 1 : 1 / 3), 0);

function boundaries(text) {
  const stack = [], positions = new Set();
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" && !(/[\p{L}\p{N}]/u.test(text[i - 1] || "") && /[\p{L}\p{N}]/u.test(text[i + 1] || ""))) {
      if (stack.at(-1) === "'") stack.pop(); else stack.push("'");
    } else if (c === '"') { if (stack.at(-1) === '"') stack.pop(); else stack.push('"'); }
    else if (pairs.has(c)) stack.push(pairs.get(c));
    else if (stack.at(-1) === c) stack.pop();
    if (!stack.length) positions.add(i + 1);
  }
  return { positions, balanced: !stack.length };
}

function sentences(text, closed) {
  const { positions, balanced } = boundaries(text);
  const ends = new Set();
  let from = 0;
  const parts = segment("en", text);
  for (let i = 0; i < parts.length; i++) {
    const at = text.indexOf(parts[i], from); if (at < 0) continue;
    from = at + parts[i].length;
    if (i < parts.length - 1 || closed) ends.add(from);
  }
  for (let i = 0; i < text.length; i++) {
    if (/[。！？]/.test(text[i])) {
      let end = i + 1;
      while (/[”’」』）)\]]/.test(text[end] || "") && end < text.length) end++;
      ends.add(end);
    }
  }
  if (closed) ends.add(text.length);
  const out = []; let consumed = 0;
  for (const end of [...ends].sort((a, b) => a - b)) {
    if (!positions.has(end) && !(closed && end === text.length)) continue;
    const sentence = text.slice(consumed, end).trim();
    if (sentence.includes("\uFFFC")) break;
    if (sentence) out.push(sentence);
    consumed = end;
  }
  return { out, consumed, balanced };
}

function clauses(text) {
  if (weight(text) <= LIMIT) return [text];
  const { positions } = boundaries(text);
  const out = []; let start = 0, lastSafe = 0;
  for (let i = 0; i < text.length; i++) {
    if (positions.has(i + 1) && /^(?:[，；：]|[,;:](?=\s))/.test(text.slice(i, i + 2))) lastSafe = i + 1;
    if (lastSafe > start && weight(text.slice(start, i + 1)) >= LIMIT) {
      out.push(text.slice(start, lastSafe).trim()); start = lastSafe;
    } else if (lastSafe === i + 1 && weight(text.slice(start, i + 1)) >= TARGET) {
      out.push(text.slice(start, i + 1).trim()); start = i + 1;
    }
  }
  if (text.slice(start).trim()) out.push(text.slice(start).trim());
  return out;
}

/** A turn owns this state. Deadlines are serviced by Host orchestration, not UI timers. */
export function createNaturalSegmenter({ now = Date.now } = {}) {
  let source = "", seen = new Map(), pending = [], group = null, deadline = null, ended = false;
  const listText = items => items.map(item => /[。！？!?；;]$/.test(item) ? item : `${item}；`).join("");
  const emitList = out => {
    if (pending.length) out.push(listText(pending));
    pending = []; group = null; deadline = null;
  };
  const update = (text, { done = false } = {}) => {
    if (ended) { if (text !== source) throw new Error("voice_reply_rewritten"); return []; }
    source = text;
    const out = [];
    if (deadline !== null && now() >= deadline) emitList(out);
    const blocks = spokenBlocks(source, { done });
    const present = new Set(blocks.map(block => block.id));
    for (const id of seen.keys()) if (!present.has(id)) throw new Error("voice_reply_rewritten");
    for (const block of blocks) {
      const previous = seen.get(block.id) || "";
      if (!block.text.startsWith(previous)) throw new Error("voice_reply_rewritten");
      const text = block.text.slice(previous.length);
      if (!text) continue;
      if (block.kind === "list") {
        if (pending.length && group !== block.group) emitList(out);
        if (!block.closed || !done && !boundaries(text).balanced || text.includes("\uFFFC")) break;
        if (weight(listText([text])) > LIMIT) {
          emitList(out); out.push(...sentences(text, true).out.flatMap(clauses));
          seen.set(block.id, block.text); continue;
        }
        if (pending.length && weight(listText([...pending, text])) > LIMIT) emitList(out);
        if (!pending.length) { group = block.group; deadline = now() + LIST_WAIT_MS; }
        pending.push(text); seen.set(block.id, block.text);
        if (pending.length >= 3 || weight(listText(pending)) >= LIMIT) emitList(out);
      } else {
        emitList(out);
        const ready = sentences(text, block.closed && (done || boundaries(text).balanced));
        for (const sentence of ready.out) out.push(...clauses(sentence));
        if (ready.consumed) seen.set(block.id, (previous + text.slice(0, ready.consumed)).trimEnd());
        if (ready.consumed < text.length) break;
      }
    }
    if (done) { emitList(out); ended = true; }
    return out;
  };
  return {
    update,
    push(chunk, options) { return update(source + chunk, options); },
    finish() { return update(source, { done: true }); },
    flush() { return update(source); },
    get deadline() { return deadline; },
    reset() { source = ""; seen = new Map(); pending = []; group = null; deadline = null; ended = false; },
  };
}
