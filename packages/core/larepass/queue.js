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

/**
 * dsh `inbox` projection per session: the latest baseline (`projections` on a
 * follow snapshot or history page) with later `agent/inbox/spliced` events
 * replayed on top. Its `next-turn` list is the queue.
 */
export function createInboxTracker() {
  const inboxes = new Map();

  return {
    seed(sessionId, projections) {
      const inbox = projections?.values?.inbox;
      const asOfSeq = projections?.asOfSeq;
      if (!sessionId || !Array.isArray(inbox?.["next-turn"]) || !Number.isInteger(asOfSeq)) return false;
      const current = inboxes.get(sessionId);
      if (current && current.seq > asOfSeq) return false;
      inboxes.set(sessionId, { seq: asOfSeq, nextTurn: inbox["next-turn"] });
      return true;
    },
    apply(sessionId, events) {
      let changed = false;
      for (const event of Array.isArray(events) ? events : []) {
        if (event?.type !== "agent/inbox/spliced" || event.data?.target !== "next-turn") continue;
        const current = inboxes.get(sessionId) ?? { seq: -1, nextTurn: [] };
        if (typeof event.seq !== "number" || event.seq <= current.seq) continue;
        const { start = 0, removedCount = 0, inserted = [] } = event.data;
        inboxes.set(sessionId, {
          seq: event.seq,
          nextTurn: current.nextTurn.toSpliced(start, removedCount, ...inserted),
        });
        changed = true;
      }
      return changed;
    },
    queue(sessionId) {
      const nextTurn = inboxes.get(sessionId)?.nextTurn ?? [];
      return normalizeQueueItems(nextTurn.map((message) => ({
        id: message?.id,
        content: message?.content,
        placement: "queued",
      })));
    },
  };
}
