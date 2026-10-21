import { isHumanUserSource } from "./context-provenance.js";
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
 * A queue edit, removal, or steer aimed at a row the host has already released.
 * The row was sent or dropped; that is not a broken host connection.
 */
export function queueItemSettled(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  if (code.includes("queue-item-not-found") || code.includes("queue-item-not-pending")) return true;
  return message.includes("no longer pending") || message.includes("queue item not found");
}

export function settleQueueResult(result) {
  if (!result?.ok && queueItemSettled(result?.error)) return { ok: true, settled: true };
  return result;
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

function blankInbox() {
  return { seq: -1, nextTurn: [], nextStep: [], held: [] };
}

/** A person's line the current turn has accepted but not yet written as `user/message`. */
function admittedRow(message) {
  if (!message || typeof message.id !== "string" || !message.id) return null;
  if (!isHumanUserSource(message.source)) return null;
  const text = textFromBlocks(message.content);
  if (!text) return null;
  return { type: "user", text, messageId: message.id, key: `steer:${message.id}`, pending: true };
}

/**
 * dsh `inbox` projection per session: the latest baseline (`projections` on a
 * follow snapshot or history page) with later `agent/inbox/spliced` events
 * replayed on top. `next-turn` is the queue. `next-step` is a line already
 * inserted into the running turn, so it belongs in the conversation now.
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
      inboxes.set(sessionId, {
        seq: asOfSeq,
        nextTurn: inbox["next-turn"],
        nextStep: Array.isArray(inbox["next-step"]) ? inbox["next-step"] : [],
        held: [],
      });
      return true;
    },
    apply(sessionId, events) {
      let changed = false;
      for (const event of Array.isArray(events) ? events : []) {
        const target = event?.type === "agent/inbox/spliced" ? event.data?.target : null;
        if (target !== "next-turn" && target !== "next-step") continue;
        const current = inboxes.get(sessionId) ?? blankInbox();
        if (typeof event.seq !== "number" || event.seq <= current.seq) continue;
        const { start = 0, removedCount = 0, inserted = [], outcome } = event.data;
        const list = target === "next-turn" ? current.nextTurn : current.nextStep;
        const removed = list.slice(start, start + removedCount);
        const next = list.toSpliced(start, removedCount, ...inserted);
        let held = current.held;
        if (target === "next-step" && removed.length) {
          const removedIds = new Set(removed.map((message) => message?.id).filter(Boolean));
          held = held.filter((message) => !removedIds.has(message.id));
          if (outcome !== "canceled") held = [...held, ...removed.filter((message) => admittedRow(message))];
        }
        inboxes.set(sessionId, {
          seq: event.seq,
          nextTurn: target === "next-turn" ? next : current.nextTurn,
          nextStep: target === "next-step" ? next : current.nextStep,
          held,
        });
        changed = true;
      }
      return changed;
    },
    messages(sessionId) {
      return inboxes.get(sessionId)?.nextTurn ?? [];
    },
    queue(sessionId) {
      const nextTurn = inboxes.get(sessionId)?.nextTurn ?? [];
      return normalizeQueueItems(nextTurn.map((message) => ({
        id: message?.id,
        content: message?.content,
        placement: "queued",
      })));
    },
    /**
     * Lines inserted into the running turn. They stay until the transcript
     * records the same message, and a canceled removal drops them.
     */
    pendingUsers(sessionId, items) {
      const current = inboxes.get(sessionId);
      if (!current) return [];
      const seen = new Set();
      for (const item of Array.isArray(items) ? items : []) {
        if (item?.type === "user" && typeof item.messageId === "string" && item.messageId) seen.add(item.messageId);
      }
      if (seen.size) current.held = current.held.filter((message) => !seen.has(message.id));
      const rows = [];
      const push = (message) => {
        const row = admittedRow(message);
        if (!row || seen.has(row.messageId) || rows.some((item) => item.messageId === row.messageId)) return;
        rows.push(row);
      };
      for (const message of current.nextStep) push(message);
      for (const message of current.held) push(message);
      return rows;
    },
  };
}
