import { producedPathsFromView } from "../files/deliverables.js";
import { contextForm, contextProvenance, isHumanUserSource } from "./context-provenance.js";
import { toolRowModel } from "./tool-row.js";

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

function callViewOf(view) {
  return view?.for === "call" ? view.view : null;
}

function resultViewOf(view) {
  return view?.for === "result" ? view.view : null;
}

function resultCallId(data) {
  return data?.message?.source?.callId || data?.callId || "";
}

function resultIsError(data) {
  if (data?.error) return true;
  const blocks = data?.message?.content;
  return Array.isArray(blocks) && blocks.some((block) => block?.isError);
}

function retrySeconds(milliseconds) {
  return Math.max(1, Math.ceil(Number(milliseconds) / 1000) || 1);
}

function blockKey(turn, step, index) {
  return `${turn ?? 0}:${step ?? 0}:${index ?? 0}`;
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

function upsert(items, indexOf, key, row) {
  if (indexOf.has(key)) {
    Object.assign(items[indexOf.get(key)], row);
    return items[indexOf.get(key)];
  }
  items.push(row);
  indexOf.set(key, items.length - 1);
  return row;
}

function settleOpen(items, running) {
  for (const row of items) {
    if (row.type === "reasoning") row.running = Boolean(running && row.running);
    if (row.type === "assistant" && !running) delete row.pending;
    if (row.type === "retry" && !running && row.retryState === "scheduled") {
      row.retryState = "cancelled";
    }
  }
}

export function foldTranscript(entries) {
  const items = [];
  const blocks = new Map();
  const tools = new Map();
  const retries = new Map();
  const fileSeen = new Set();
  let files = [];
  let filesAt = -1;
  let running = false;
  let error = "";
  let streamCursor = { loc: "", kind: "", index: 0 };

  const rememberFile = (path) => {
    if (!path || fileSeen.has(path)) return;
    fileSeen.add(path);
    files.push(path);
  };

  const syncFiles = () => {
    if (!files.length) return;
    if (filesAt >= 0) {
      items[filesAt].paths = [...files];
      return;
    }
    items.push({ type: "files", paths: [...files] });
    filesAt = items.length - 1;
  };

  const closeTurn = () => {
    running = false;
    for (const row of items) {
      if (row.type === "reasoning") row.running = false;
      if (row.type === "assistant") delete row.pending;
    }
    syncFiles();
  };

  const putBlock = (turn, step, index, row) => {
    upsert(items, blocks, blockKey(turn, step, index), row);
  };

  const chunkIndex = (data, chunk) => {
    if (typeof chunk.index === "number") return chunk.index;
    const loc = `${data.turn ?? 0}:${data.step ?? 0}`;
    const kind = chunk.type === "reasoning-delta" || chunk.block?.type === "reasoning"
      ? "reasoning"
      : chunk.type === "text-delta" || chunk.block?.type === "text"
        ? "text"
        : chunk.type;
    if (streamCursor.loc !== loc || streamCursor.kind !== kind) {
      streamCursor.index = streamCursor.loc === loc ? streamCursor.index + 1 : 0;
      streamCursor.loc = loc;
      streamCursor.kind = kind;
    }
    return streamCursor.index;
  };

  const applyChunk = (data) => {
    const chunk = data?.chunk;
    if (!chunk || typeof chunk !== "object") return;
    const turn = data.turn;
    const step = data.step;
    const index = chunkIndex(data, chunk);
    if (chunk.type === "text-delta" && typeof chunk.text === "string") {
      const prev = blocks.has(blockKey(turn, step, index))
        ? items[blocks.get(blockKey(turn, step, index))]
        : null;
      const text = `${prev?.type === "assistant" ? prev.text : ""}${chunk.text}`;
      putBlock(turn, step, index, {
        type: "assistant",
        text,
        ...(running ? { pending: true } : {}),
      });
      return;
    }
    if (chunk.type === "reasoning-delta" && typeof chunk.text === "string") {
      const prev = blocks.has(blockKey(turn, step, index))
        ? items[blocks.get(blockKey(turn, step, index))]
        : null;
      const text = `${prev?.type === "reasoning" ? prev.text : ""}${chunk.text}`;
      putBlock(turn, step, index, {
        type: "reasoning",
        text,
        running: Boolean(running),
      });
      return;
    }
    if (chunk.type === "block-end" && chunk.block?.type === "text" && typeof chunk.block.text === "string") {
      putBlock(turn, step, index, {
        type: "assistant",
        text: chunk.block.text,
        ...(running ? { pending: true } : {}),
      });
      return;
    }
    if (chunk.type === "block-end" && chunk.block?.type === "reasoning" && typeof chunk.block.text === "string") {
      putBlock(turn, step, index, {
        type: "reasoning",
        text: chunk.block.text,
        running: Boolean(running),
      });
    }
  };

  const applyAssistantMessage = (data) => {
    const content = data?.message?.content;
    const turn = data?.turn ?? data?.message?.turn;
    const step = data?.step ?? data?.message?.step;
    if (!Array.isArray(content)) return;
    content.forEach((block, index) => {
      if (block?.type === "reasoning" && typeof block.text === "string") {
        putBlock(turn, step, index, { type: "reasoning", text: block.text, running: false });
        return;
      }
      if (block?.type === "text" && typeof block.text === "string") {
        putBlock(turn, step, index, { type: "assistant", text: block.text });
      }
    });
  };

  for (const entry of Array.isArray(entries) ? entries : []) {
    const event = eventOf(entry);
    if (!event) continue;
    const data = event.data ?? {};
    const view = entryView(entry, event);

    if (event.type === "turn/start") {
      closeTurn();
      files = [];
      fileSeen.clear();
      filesAt = -1;
      running = true;
      error = "";
      continue;
    }

    if (event.type === "turn/end") {
      if (data.reason?.kind === "error") {
        error = data.reason.error?.message || "turn failed";
      }
      closeTurn();
      continue;
    }

    if (event.type === "user/message") {
      const text = textFromBlocks(data.content);
      if (isHumanUserSource(data.source)) {
        if (text) items.push({ type: "user", text });
        continue;
      }
      const provenance = contextProvenance(data.source);
      items.push({
        type: "context",
        role: provenance.role,
        label: provenance.label,
        form: contextForm(data.source),
        text,
      });
      continue;
    }

    if (event.type === "assistant/message") {
      applyAssistantMessage(data);
      continue;
    }

    if (event.type === "assistant/chunk") {
      applyChunk(data);
      continue;
    }

    if (event.type === "tool/call") {
      const callView = callViewOf(view);
      const argsRaw = typeof data.arguments === "string" ? data.arguments : "";
      const model = toolRowModel(data.name, argsRaw);
      const row = {
        type: "tool",
        callId: data.callId,
        name: data.name,
        status: "running",
        argsRaw,
        paths: producedPathsFromView(callView),
        ...model,
      };
      items.push(row);
      if (data.callId) tools.set(data.callId, items.length - 1);
      continue;
    }

    if (event.type === "tool/result") {
      const id = resultCallId(data);
      const index = tools.get(id);
      const tool = index === undefined ? null : items[index];
      if (tool) {
        tool.status = resultIsError(data) ? "error" : "done";
        const resultView = resultViewOf(view);
        if (resultView?.title) tool.title = resultView.title;
        if (tool.status === "done") {
          for (const path of tool.paths) rememberFile(path);
        }
      }
      continue;
    }

    if (event.type === "llm/retry") {
      const retryId = data.retryId || String(event.seq ?? items.length);
      upsert(items, retries, retryId, {
        type: "retry",
        retryId,
        retry: data.retry,
        maxRetries: data.maxRetries,
        mode: data.mode,
        delayMs: data.delayMs,
        seconds: retrySeconds(data.delayMs),
        failure: data.failure,
        retryState: "scheduled",
      });
      continue;
    }

    if (event.type === "llm/retry-started") {
      const retryId = data.retryId;
      const index = retries.get(retryId);
      if (index !== undefined) items[index].retryState = "started";
    }
  }

  settleOpen(items, running);
  if (running) syncFiles();
  return {
    items,
    messages: messagesFromItems(items),
    running,
    error,
  };
}
