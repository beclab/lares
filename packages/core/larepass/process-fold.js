/**
 * One disclosure for a turn's reasoning and tool calls, matching dsh chat.
 * A settled turn uses the "completed in" control. While the turn is still
 * running, the same rows sit behind one live activity line (or a finished
 * activity summary once the reply has started). The person's message and the
 * final answer stay outside. That answer is the reply chrome's row only once
 * the turn has settled; a durable assistant message mid-turn is not done yet.
 * A turn that ended in error or abort stays open.
 */

const DETAIL_LIMIT = 160;
const DETAIL_KEYS = [
  "title", "description", "objective", "task", "task_name", "name",
  "question", "questions", "prompt", "message", "command", "cmd",
  "queries", "query", "pattern", "url", "uri", "file_path", "path",
  "target", "action", "status",
];
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const PROCESS = new Set(["reasoning", "tool", "retry", "context"]);

function lastAssistant(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].row?.type === "assistant") return i;
  }
  return -1;
}

function isWaitingQuestion(row) {
  return row?.type === "tool" && row.name === "ask_user_question" && row.status === "running";
}

function isProcess(row, index, answerAt) {
  if (isWaitingQuestion(row)) return false;
  if (row?.type === "assistant") return index !== answerAt;
  return PROCESS.has(row?.type);
}

function activity(name) {
  if (name === "read") return "read";
  if (name === "read_image") return "readImage";
  if (name === "grep" || name === "glob" || name?.endsWith("_inspect")) return "search";
  if (name === "write") return "write";
  if (name === "edit" || name === "apply_patch") return "edit";
  if (["bash", "pwsh", "exec_command", "write_stdin"].includes(name) || name?.startsWith("terminal_")) return "commands";
  if (name === "run_code") return "code";
  if (name === "web_search") return "webSearch";
  if (name === "web_fetch") return "webFetch";
  if (name === "subagent" || name?.startsWith("subagent_")) return "subagents";
  if (["todo_write", "create_goal", "update_goal", "get_goal"].includes(name)) return "plan";
  if (name === "ask_user_question" || name === "request_user_input") return "questions";
  return "tools";
}

function clipDetail(value) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  const chars = Array.from(segmenter.segment(normalized), (part) => part.segment);
  if (chars.length <= DETAIL_LIMIT) return normalized;
  return `${chars.slice(0, DETAIL_LIMIT - 1).join("").trimEnd()}…`;
}

function toolDetail(row) {
  let args;
  try {
    args = JSON.parse(row?.argsRaw ?? "");
  } catch {
    return clipDetail(row?.name);
  }
  if (args === null || typeof args !== "object") return clipDetail(row?.name);
  for (const key of DETAIL_KEYS) {
    if (!(key in args)) continue;
    const value = args[key];
    if (key === "questions" && Array.isArray(value)) {
      const question = value.find((item) => item && typeof item.question === "string")?.question;
      const detail = clipDetail(question);
      if (detail) return detail;
      continue;
    }
    const detail = clipDetail(typeof value === "string" || (Array.isArray(value) && value.every((item) => typeof item === "string"))
      ? (Array.isArray(value) ? value.join(", ") : value)
      : "");
    if (detail) return detail;
  }
  return clipDetail(row?.name);
}

function reasoningDetail(members) {
  for (let i = members.length - 1; i >= 0; i--) {
    if (members[i].row?.type !== "reasoning") continue;
    const paragraphs = String(members[i].row.text ?? "").split(/\r?\n[\t ]*\r?\n/);
    for (let p = paragraphs.length - 1; p >= 0; p--) {
      const detail = clipDetail(paragraphs[p].replaceAll("**", ""));
      if (detail) return detail;
    }
  }
  return "";
}

function runningTool(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const row = entries[i].row;
    if (row?.type === "tool" && row.status === "running") return row;
  }
  return null;
}

function toolCounts(members) {
  const counts = new Map();
  const order = [];
  for (const { row } of members) {
    if (row?.type !== "tool") continue;
    const kind = activity(row.name);
    if (!counts.has(kind)) order.push(kind);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return order.map((kind) => ({ kind, count: counts.get(kind) }));
}

function processTitle(t, counts) {
  const ranked = [...counts].sort((left, right) => right.count - left.count);
  const labels = ranked.slice(0, 3).map(({ kind }) => t(`message.stepProcess.done.${kind}`));
  const first = labels[0];
  if (first === undefined) return t("message.stepProcess.done.thinking");
  const continuation = (label) => label.charAt(0).toLowerCase() + label.slice(1);
  if (labels.length === 1) return first;
  if (labels.length === 2) {
    const prefix = t("message.stepProcess.sharedPrefix");
    const second = labels[1];
    const trimmed = prefix !== "" && first.startsWith(prefix) && second.startsWith(prefix)
      ? second.slice(prefix.length)
      : second;
    return t("message.stepProcess.joinTwo", { first, second: continuation(trimmed) });
  }
  const title = [first, ...labels.slice(1).map(continuation)].join(t("message.stepProcess.comma"));
  return ranked.length > 3 ? t("message.stepProcess.more", { title }) : title;
}

function liveTitle(t, block) {
  const tool = block.runningTool;
  const kind = tool ? activity(tool.name) : "thinking";
  const label = t(`message.stepProcess.${kind}`);
  const detail = tool ? toolDetail(tool) : reasoningDetail(block.members);
  if (!detail) return label;
  return `${label}${t("message.turnProcess.separator")}${detail}`;
}

function runMsOf(entries, answerAt) {
  if (answerAt >= 0 && entries[answerAt].row.metrics?.runMs != null) {
    return entries[answerAt].row.metrics.runMs;
  }
  return entries.find((entry) => entry.row.turnRunMs != null)?.row.turnRunMs;
}

/** Wall-clock run length the way dsh prints it: hours, then minutes once a minute is reached, then seconds. */
export function formatRunDuration(ms, unit) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  let text = "";
  if (hours > 0) text += `${hours}${unit.hour}`;
  if (total >= 60) text += `${minutes}${unit.minute}`;
  text += `${seconds}${unit.second}`;
  return text;
}

export function processFoldLabel(t, block = {}) {
  if (block.phase === "live") return liveTitle(t, block);
  if (block.phase === "summary") return processTitle(t, toolCounts(block.members ?? []));
  const reason = block.reason ?? "completed";
  if (reason === "aborted") return t("message.stopped");
  if (reason === "error") return t("message.turnProcess.failed");
  if (block.runMs == null) return t("message.turnProcess.worked");
  const duration = formatRunDuration(Math.max(1000, block.runMs), {
    hour: t("duration.hourUnit"),
    minute: t("duration.minuteUnit"),
    second: t("duration.secondUnit"),
  });
  return t("message.turnProcess.took", { duration });
}

/** The live activity line replaces the bottom running clock. */
export function hidesRunningClock(blocks) {
  return (Array.isArray(blocks) ? blocks : []).some((block) =>
    block?.phase === "live"
    || (block?.row?.type === "tool" && block.row.name === "ask_user_question" && block.row.status === "running"));
}

export function transcriptBlocks(items, { running = false } = {}) {
  const list = Array.isArray(items) ? items : [];
  const groups = [];
  for (let index = 0; index < list.length; index++) {
    const row = list[index];
    const prev = groups[groups.length - 1];
    const turn = Number.isInteger(row?.turn) ? row.turn : null;
    const split = !prev
      || row?.type === "user"
      || (turn != null && prev.turn != null && turn !== prev.turn);
    if (split) groups.push({ turn, entries: [] });
    const group = groups[groups.length - 1];
    if (group.turn == null && turn != null) group.turn = turn;
    group.entries.push({ row, index });
  }

  const blocks = [];
  groups.forEach((group, groupIndex) => {
    const closed = groupIndex < groups.length - 1 || !running;
    const answerAt = lastAssistant(group.entries);
    const members = group.entries.filter((entry, index) => isProcess(entry.row, index, answerAt));
    const hasWork = members.some((entry) => entry.row.type !== "context");
    const reason = group.entries.find((entry) => entry.row.turnReason)?.row.turnReason || "completed";
    const runMs = runMsOf(group.entries, answerAt);
    const showHeader = hasWork;
    const openTurn = !closed;
    const tool = openTurn ? runningTool(group.entries) : null;
    const phase = !showHeader ? "" : openTurn ? (tool || answerAt < 0 ? "live" : "summary") : "turn";
    const foldable = showHeader && phase !== "turn"
      ? true
      : showHeader && reason !== "error" && reason !== "aborted";
    const memberSet = new Set(members);
    let folded = false;
    for (const entry of group.entries) {
      if (showHeader && !folded && memberSet.has(entry)) {
        blocks.push({
          kind: "fold",
          key: `fold-${group.turn ?? `g${groupIndex}`}-${entry.row?.key || entry.row?.id || entry.index}`,
          phase,
          foldable,
          reason,
          runMs,
          members,
          runningTool: tool,
        });
        folded = true;
      }
      if (memberSet.has(entry) && showHeader) continue;
      blocks.push({
        kind: "row",
        key: entry.row?.key || entry.row?.id || `row-${entry.index}`,
        index: entry.index,
        row: entry.row,
        settled: closed,
      });
    }
  });
  return blocks;
}
