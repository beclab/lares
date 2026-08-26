import { producedPathsFromView } from "../files/deliverables.js";

const SKIP_USER_KINDS = new Set(["plugin", "tool"]);

export function textFromBlocks(blocks) {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

function eventOf(entry) {
  if (!entry || typeof entry !== "object") return null;
  const event = "event" in entry && entry.event ? entry.event : entry;
  return event && typeof event === "object" ? event : null;
}

function entryView(entry, event) {
  return entry?.view ?? event?.view ?? null;
}

export function mergeEvents(base, extra) {
  const bySeq = new Map();
  for (const item of [...(Array.isArray(base) ? base : []), ...(Array.isArray(extra) ? extra : [])]) {
    const event = eventOf(item);
    if (!event || typeof event.seq !== "number") continue;
    const view = entryView(item, event);
    bySeq.set(event.seq, view ? { ...event, view } : event);
  }
  return [...bySeq.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, event]) => event);
}

function emptyOpen() {
  return {
    reasoning: "",
    text: "",
    settled: false,
    tools: [],
    toolById: new Map(),
    files: [],
    fileSeen: new Set(),
  };
}

function callViewOf(view) {
  return view?.for === "call" ? view.view : null;
}

function resultViewOf(view) {
  return view?.for === "result" ? view.view : null;
}

function toolTitle(name, view) {
  if (typeof view?.title === "string" && view.title.trim()) return view.title;
  return name || "tool";
}

function toolDetail(data, view) {
  if (typeof view?.description === "string" && view.description.trim()) return view.description;
  const raw = data?.arguments;
  if (typeof raw !== "string" || !raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed.command || parsed.path || parsed.query || parsed.url || "";
    }
  } catch {
    // keep a short raw fallback
  }
  return raw.slice(0, 200);
}

function rememberFile(open, path) {
  if (!path || open.fileSeen.has(path)) return;
  open.fileSeen.add(path);
  open.files.push(path);
}

function applyChunk(open, chunk) {
  if (!chunk || typeof chunk !== "object") return;
  if (chunk.type === "text-delta" && typeof chunk.text === "string") {
    open.text += chunk.text;
    return;
  }
  if (chunk.type === "reasoning-delta" && typeof chunk.text === "string") {
    open.reasoning += chunk.text;
    return;
  }
  if (chunk.type === "block-end" && chunk.block?.type === "text" && typeof chunk.block.text === "string" && !open.text) {
    open.text = chunk.block.text;
  }
  if (chunk.type === "block-end" && chunk.block?.type === "reasoning" && typeof chunk.block.text === "string" && !open.reasoning) {
    open.reasoning = chunk.block.text;
  }
}

function applyAssistantMessage(open, content) {
  let reasoning = "";
  let text = "";
  for (const block of Array.isArray(content) ? content : []) {
    if (block?.type === "reasoning" && typeof block.text === "string") reasoning += block.text;
    if (block?.type === "text" && typeof block.text === "string") text += block.text;
  }
  open.reasoning = reasoning;
  open.text = text;
  open.settled = true;
}

function resultCallId(data) {
  return data?.message?.source?.callId || data?.callId || "";
}

function resultIsError(data) {
  if (data?.error) return true;
  const blocks = data?.message?.content;
  return Array.isArray(blocks) && blocks.some((block) => block?.isError);
}

function snapshotOpen(open, running) {
  const items = [];
  if (open.reasoning) {
    items.push({
      type: "reasoning",
      text: open.reasoning,
      running: Boolean(running && !open.settled),
    });
  }
  for (const tool of open.tools) {
    items.push({
      type: "tool",
      callId: tool.callId,
      name: tool.name,
      title: tool.title,
      status: tool.status,
      detail: tool.detail,
      paths: tool.paths,
    });
  }
  if (open.text) {
    items.push({
      type: "assistant",
      text: open.text,
      ...(running && !open.settled ? { pending: true } : {}),
    });
  }
  if (open.files.length) items.push({ type: "files", paths: [...open.files] });
  return items;
}

function messagesFromItems(items) {
  const messages = [];
  for (const item of items) {
    if (item.type === "user") messages.push({ role: "user", text: item.text });
    if (item.type === "assistant") {
      messages.push({
        role: "assistant",
        text: item.text,
        ...(item.pending ? { pending: true } : {}),
      });
    }
  }
  return messages;
}

export function foldTranscript(entries) {
  const items = [];
  let open = emptyOpen();
  let running = false;
  let error = "";

  const flushOpen = () => {
    items.push(...snapshotOpen(open, false));
    open = emptyOpen();
  };

  for (const entry of Array.isArray(entries) ? entries : []) {
    const event = eventOf(entry);
    if (!event) continue;
    const data = event.data ?? {};
    const view = entryView(entry, event);

    if (event.type === "turn/start") {
      flushOpen();
      running = true;
      error = "";
      continue;
    }

    if (event.type === "turn/end") {
      running = false;
      if (data.reason?.kind === "error") {
        error = data.reason.error?.message || "turn failed";
      }
      flushOpen();
      continue;
    }

    if (event.type === "user/message") {
      if (SKIP_USER_KINDS.has(data.source?.kind)) continue;
      const text = textFromBlocks(data.content);
      if (text) items.push({ type: "user", text });
      continue;
    }

    if (event.type === "assistant/message") {
      applyAssistantMessage(open, data.message?.content);
      continue;
    }

    if (event.type === "assistant/chunk") {
      applyChunk(open, data.chunk);
      continue;
    }

    if (event.type === "tool/call") {
      const callView = callViewOf(view);
      const tool = {
        callId: data.callId,
        name: data.name,
        title: toolTitle(data.name, callView),
        status: "running",
        detail: String(toolDetail(data, callView) || ""),
        paths: producedPathsFromView(callView),
        callView,
      };
      open.tools.push(tool);
      if (data.callId) open.toolById.set(data.callId, tool);
      continue;
    }

    if (event.type === "tool/result") {
      const id = resultCallId(data);
      const tool = open.toolById.get(id);
      const resultView = resultViewOf(view);
      if (tool) {
        tool.status = resultIsError(data) ? "error" : "done";
        if (resultView) tool.title = toolTitle(tool.name, resultView);
        if (tool.status === "done") {
          for (const path of tool.paths) rememberFile(open, path);
        }
      }
    }
  }

  const all = [...items, ...snapshotOpen(open, running)];
  return {
    items: all,
    messages: messagesFromItems(all),
    running,
    error,
  };
}
