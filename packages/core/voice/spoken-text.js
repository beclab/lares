import emojiRegex from "emoji-regex";
import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

markdown.inline.ruler.before("backticks", "speech_open_code", (state, silent) => {
  if (!silent && state.env.streaming && state.src[state.pos] === "`") {
    const marks = state.src.slice(state.pos).match(/^`+/)[0];
    const rest = state.src.slice(state.pos + marks.length);
    if (![...rest.matchAll(/`+/g)].some((match) => match[0].length === marks.length)) {
      state.env.pending = Math.min(state.env.pending, state.pos);
    }
  }
  return false;
});

// Retain parser positions only for this invocation; no state survives a turn.
markdown.inline.ruler.before("strikethrough", "speech_delimiters", (state, silent) => {
  if (silent || !state.env.streaming || !/[*_~]/.test(state.src[state.pos])) return false;
  const positions = state.env.states.get(state) ?? new Map();
  state.env.states.set(state, positions);
  const scanned = state.scanDelims(state.pos, state.src[state.pos] !== "_");
  const first = state.tokens.length + (state.pending ? 1 : 0);
  for (let index = 0; index < scanned.length; index++) positions.set(first + index, state.pos + index);
  return false;
});
markdown.inline.ruler2.before("fragments_join", "speech_unclosed_pairs", (state) => {
  if (!state.env.streaming) return;
  const positions = state.env.states.get(state);
  for (const delimiter of state.delimiters) {
    if (delimiter.open && delimiter.end < 0 && state.tokens[delimiter.token]?.type === "text") {
      state.env.pending = Math.min(state.env.pending, positions?.get(delimiter.token) ?? Infinity);
    }
  }
});
markdown.inline.ruler.push("speech_incomplete", (state, silent) => {
  if (!silent && state.env.streaming && /[\[!`<&\\]/.test(state.src[state.pos])) {
    state.env.pending = Math.min(state.env.pending, state.pos);
  }
  return false;
});

function tokensText(tokens) {
  return tokens.map((token) => {
    if (token.type === "image") return tokensText(token.children ?? []);
    if (token.type === "softbreak" || token.type === "hardbreak") return "\n";
    return token.type === "text" || token.type === "code_inline" ? token.content : "";
  }).join("");
}

function inlineText(source, streaming, references) {
  const env = { streaming, references, pending: Infinity, states: new Map() };
  let tokens = markdown.parseInline(source, env)[0].children;
  if (Number.isFinite(env.pending)) tokens = markdown.parseInline(source.slice(0, env.pending), { references })[0].children;
  const last = tokens.findLast((token) => token.type === "image" || token.content?.trim());
  return { text: tokensText(tokens), pending: Number.isFinite(env.pending) || last?.type === "image" && !tokensText(last.children ?? []).trim() };
}

const RULE_LINE = /^\s*(?:\|?\s*:?-{3,}:?\s*)+\|?\s*$|^\s*([-*_])(?:\s*\1){2,}\s*$/;
const BLOCK_MARK = /^\s*(?:>(?:[ \t]+|$))*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)?/;

function blockLine(line, table = false) {
  if (RULE_LINE.test(line)) return "";
  let content = line.replace(BLOCK_MARK, "");
  if (/^\s*(?:>\s*)*#{1,6}\s+/.test(line)) content = content.replace(/[ \t]+#+[ \t]*$/, "");
  if (!table && !/^\s*\|.*\|\s*$/.test(content)) return content;
  // Only table framing is removed; inline code and escaped pipes are content.
  return content.trim().replace(/^\||(?<!\\)\|$/g, "").replace(/\\.|(`+)[\s\S]*?\1|\|/g, (match) => match === "|" ? " " : match);
}

function pipeAt(line) {
  return [...line.matchAll(/\\.|(`+)[\s\S]*?\1|\|/g)].find((match) => match[0] === "|")?.index;
}

function blockText(source, done) {
  const rows = new Set(), visible = new Set(), env = {};
  for (const token of markdown.parse(source, env)) {
    if (token.type === "tr_open" && token.map) rows.add(token.map[0]);
    if (["inline", "code_block", "tr_open"].includes(token.type) && token.map) {
      for (let line = token.map[0]; line < token.map[1]; line++) visible.add(line);
    }
  }
  if (!done) {
    const complete = {};
    markdown.parse(source.slice(0, source.lastIndexOf("\n") + 1), complete);
    env.references = complete.references;
  }
  return {
    text: source.split("\n").map((line, index) => visible.has(index) ? blockLine(line, rows.has(index)) : "").join("\n"),
    references: env.references,
  };
}

function withoutEmoji(text) {
  return text.replace(emojiRegex(), (match) => {
    if (/^[0-9#*]\uFE0F?\u20E3$/.test(match)) return match[0];
    if (/^[©®™]$/.test(match)) return match;
    return " ";
  });
}

/** The assistant's spoken copy; never apply this to stored messages or raw TTS API input. */
function prepareSource(text, done, structural = false) {
  let pending = false;
  const skip = (match, offset, source) => {
    if (offset + match.length >= source.trimEnd().length) pending = true;
    return structural ? "\n\n---\n\n" : " ";
  };
  let source = String(text ?? "")
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, skip)
    .replace(/^[\s\S]*?<\/think>/i, skip)
    .replace(/<think\b[\s\S]*$/i, () => { pending = true; return ""; })
    .replace(/(`{3,}|~{3,})[\s\S]*?\1/g, (match, _marks, offset, source) => skip(match, offset, source));
  const openFence = /`{3,}|~{3,}/.exec(source);
  if (openFence) { pending = true; source = source.slice(0, openFence.index); }
  if (!done) {
    const lines = source.split("\n");
    let candidate = lines.length - 1;
    // An unfinished separator can still turn the preceding line into a table.
    if (candidate > 0 && /^[\s|:-]*$/.test(lines[candidate]) && !RULE_LINE.test(lines[candidate - 1]) && pipeAt(lines[candidate - 1]) !== undefined) candidate--;
    const pipe = pipeAt(lines[candidate]);
    if (pipe !== undefined) {
      source = [...lines.slice(0, candidate), lines[candidate].slice(0, pipe)].join("\n");
      pending = true;
    }
  }
  return { source, pending };
}

export function spokenLines(text, { done = true } = {}) {
  let { source, pending } = prepareSource(text, done);
  const blocks = blockText(source, done);
  const inline = inlineText(blocks.text, !done, blocks.references);
  // An opaque unfinished tail keeps earlier completed sentences eligible. It
  // is always the final, withheld sentence and never reaches synthesis.
  let plain = inline.text;
  if (!done) {
    const lineStart = plain.lastIndexOf("\n") + 1;
    const end = plain.slice(lineStart).trimEnd();
    const tail = [...graphemes.segment(end)].at(-1);
    if (tail && (emojiRegex().test(tail.segment) || /[\uD800-\uDBFF]$/.test(tail.segment))) {
      plain = plain.slice(0, lineStart) + end.slice(0, tail.index);
      pending = true;
    }
    if (pending || inline.pending) plain += "\uFFFC";
  }
  return withoutEmoji(plain).split("\n").map((line) => line.replace(/\s+/g, " ").trim());
}


/** Structural units for speech aggregation; rendered/stored Markdown is untouched. */
export function spokenBlocks(text, { done = true } = {}) {
  const { source, pending } = prepareSource(text, done, true);
  const env = {}, tokens = markdown.parse(source, env);
  const references = blockText(source, done).references;
  const last = tokens.findLastIndex(token => ["inline", "code_block"].includes(token.type));
  const lists = [], items = [], result = [];
  let heading = false, barrier = 0, rowLine = 0, cell = 0;
  const paragraphs = new Set();
  for (const [index, token] of tokens.entries()) {
    if (token.type === "tr_open") { rowLine = token.map[0]; cell = 0; }
    if (token.type === "hr" || token.type === "fence") barrier++;
    if (token.type.endsWith("list_open")) lists.push(`${token.map[0]}:${token.level}`);
    else if (token.type.endsWith("list_close")) lists.pop();
    else if (token.type === "list_item_open") items.push(token.map[0]);
    else if (token.type === "list_item_close") items.pop();
    else if (token.type === "heading_open") heading = true;
    else if (token.type === "heading_close") heading = false;
    else if (["inline", "code_block"].includes(token.type)) {
      const map = token.map || [rowLine, rowLine + 1];
      const id = token.map ? `${map[0]}:${token.type}` : `${map[0]}:cell:${cell++}`;
      const nextBlock = tokens.slice(index + 1).some(next => next.map && next.map[0] >= map[1]);
      const closed = done || index < last || nextBlock || map[1] < source.split("\n").length - 1;
      const inline = inlineText(token.content, !done, references);
      let plain = inline.text;
      if (!done && !closed) {
        const tail = [...graphemes.segment(plain.trimEnd())].at(-1);
        if (tail && (emojiRegex().test(tail.segment) || /[\uD800-\uDBFF]$/.test(tail.segment))) plain = plain.slice(0, tail.index);
      }
      if (!done && (inline.pending || index === last && pending)) plain += "\uFFFC";
      plain = withoutEmoji(plain).replace(/\s+/g, " ").trim();
      const continuation = lists.length && paragraphs.has(items.at(-1));
      if (lists.length) paragraphs.add(items.at(-1));
      if (plain) result.push({ id, text: plain, closed,
        kind: lists.length && !continuation ? "list" : heading ? "heading" : "paragraph",
        group: `${lists.at(-1)}:${barrier}`, item: items.at(-1), depth: lists.length });
    }
  }
  return result;
}
