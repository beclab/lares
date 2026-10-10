import { normalizeQueueItems } from "./queue.js";

/** Gateway WebSocket. A bare socket stays up on ping/pong; logical streams are separate. */
export const MUX_PATH = "/api/remote.mux";

export const MUX_FETCH_HEADERS = {
  accept: "text/event-stream",
  "cache-control": "no-cache",
  "accept-encoding": "identity",
};

export function muxWsUrl(httpUrl, origin = "http://localhost") {
  const url = new URL(httpUrl, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

/** One logical stream on `/api/remote.mux`. `workspace/follow` has no arguments. */
export function remoteStreamOpen(streamId, endpoint, args = {}) {
  return {
    type: "open",
    streamId,
    endpoint,
    payload: { args },
  };
}

/** Same `session/follow` open the dsh web client sends on this socket. */
export function sessionFollowOpen(streamId, sessionId) {
  return remoteStreamOpen(streamId, "session/follow", {
    request: {
      address: { kind: "session", sessionId },
      assistantStream: true,
    },
  });
}

/** Host-forwarded Cordis events; questions and approvals arrive here as waterfalls. */
export function remoteEventsOpen(streamId) {
  return remoteStreamOpen(streamId, "$events");
}

/**
 * One `$events` item. A waterfall this client does not answer passes as
 * `next` so the Host is not left waiting on it; `agentId` is the session.
 */
export function classifyRemoteEvent(value) {
  if (!value || typeof value !== "object") return null;
  if (value.type === "ready" && typeof value.clientId === "string") {
    return { kind: "ready", clientId: value.clientId };
  }
  if (value.type === "cancel" && typeof value.eventId === "string") {
    return { kind: "cancel", eventId: value.eventId };
  }
  if (value.type !== "waterfall" || typeof value.eventId !== "string") return null;
  const request = value.request && typeof value.request === "object" ? value.request : {};
  const sessionId = typeof value.agentId === "string" ? value.agentId : "";
  if (value.event === "user-questions/request" && Array.isArray(request.questions) && sessionId) {
    return {
      kind: "question",
      eventId: value.eventId,
      sessionId,
      callId: request.wait?.callId,
      questions: request.questions,
    };
  }
  if (value.event === "approval/request" && typeof request.toolName === "string" && sessionId) {
    return {
      kind: "approval",
      eventId: value.eventId,
      sessionId,
      toolName: request.toolName,
      callId: request.callId,
      reason: request.displayReason ?? request.reason,
    };
  }
  return { kind: "pass", eventId: value.eventId };
}

function liveChunkEvent(seq, turn, step, chunk) {
  if (!chunk || typeof chunk !== "object") return null;
  if (chunk.type !== "text-delta" && chunk.type !== "reasoning-delta" && chunk.type !== "block-end") {
    return null;
  }
  return {
    type: "assistant/chunk",
    seq,
    live: true,
    data: { turn, step, chunk },
  };
}

/**
 * Fold one `session/follow` downlink into transcript events.
 * Snapshot and durable `event` frames are the session log. `assistant-stream`
 * frames are the in-progress think and reply, placed just after the latest
 * durable seq so a later `assistant/message` replaces them.
 */
export function createSessionFollow() {
  let cursor = -1;
  let liveCount = 0;
  let attempt = null;

  const note = (event) => {
    if (typeof event?.seq !== "number" || event.seq <= cursor) return;
    cursor = event.seq;
    liveCount = 0;
  };

  const nextLiveSeq = () => {
    liveCount += 1;
    return cursor + 1 - 1 / (liveCount + 1);
  };

  const fromChunk = (turn, step, chunk) => liveChunkEvent(nextLiveSeq(), turn, step, chunk);

  const fromCompact = (turn, step, stream, limit) => {
    const events = [];
    let seen = 0;
    const push = (chunk) => {
      if (seen >= limit) return false;
      seen += 1;
      const event = fromChunk(turn, step, chunk);
      if (event) events.push(event);
      return true;
    };
    for (const record of Array.isArray(stream) ? stream : []) {
      if (record?.type === "text-chunks" || record?.type === "reasoning-chunks") {
        const type = record.type === "text-chunks" ? "text-delta" : "reasoning-delta";
        for (const text of record.texts ?? []) {
          if (!push({ type, index: record.index, text: String(text ?? "") })) return events;
        }
        continue;
      }
      if (record?.type === "chunk" && !push(record.chunk)) return events;
    }
    return events;
  };

  return {
    reset() {
      cursor = -1;
      liveCount = 0;
      attempt = null;
    },
    push(frame) {
      if (!frame || typeof frame !== "object") return null;
      if (frame.type === "snapshot") {
        const events = [];
        for (const record of Array.isArray(frame.records) ? frame.records : []) {
          const event = record?.event;
          if (!event || typeof event.seq !== "number") continue;
          note(event);
          events.push(event);
        }
        const opening = frame.assistantStream?.activeAttempt;
        attempt = opening
          ? {
            attemptId: opening.attemptId,
            turn: opening.turn,
            step: opening.step,
            nextIndex: opening.nextIndex ?? 0,
          }
          : null;
        if (opening) {
          const limit = Number.isInteger(opening.nextIndex) ? opening.nextIndex : Number.POSITIVE_INFINITY;
          events.push(...fromCompact(opening.turn, opening.step, opening.stream, limit));
        }
        return { events, ready: true, projections: frame.projections };
      }
      if (frame.type === "event" && frame.event && typeof frame.event.seq === "number") {
        const event = frame.event;
        note(event);
        const settles = event.type === "assistant/message" || event.type === "turn/end";
        if (settles) attempt = null;
        return { events: [event], dropLive: settles };
      }
      if (frame.type !== "assistant-stream" || !frame.frame || typeof frame.frame !== "object") return null;
      const live = frame.frame;
      if (live.type === "start") {
        attempt = {
          attemptId: live.attemptId,
          turn: live.turn,
          step: live.step,
          nextIndex: 0,
        };
        return { events: [] };
      }
      if (live.type === "chunk") {
        if (!attempt || attempt.attemptId !== live.attemptId) return { events: [] };
        if (live.index !== attempt.nextIndex) {
          attempt = null;
          return { events: [], resync: true };
        }
        attempt.nextIndex += 1;
        const event = fromChunk(attempt.turn, attempt.step, live.chunk);
        return { events: event ? [event] : [] };
      }
      if (live.type === "end") {
        const abandoned = attempt?.attemptId === live.attemptId && live.outcome?.kind === "abandoned";
        attempt = null;
        return { events: [], dropLive: abandoned };
      }
      return null;
    },
  };
}

export function classifyStreamFrame(message) {
  if (!message || typeof message.streamId !== "string" || !message.streamId) return null;
  if (message.type === "item") return { kind: "stream", streamId: message.streamId, value: message.value };
  if (message.type === "end") return { kind: "stream-end", streamId: message.streamId };
  if (message.type === "error") return { kind: "stream-error", streamId: message.streamId, error: message.error };
  return null;
}

/** The first `workspace/follow` item is the full workspace projection. */
export function workspaceBaseline(message) {
  if (message?.type !== "item") return null;
  const frame = message.value;
  if (frame?.type !== "baseline" || !frame.value || typeof frame.value !== "object") return null;
  return frame.value;
}

export function splitSseBlocks(buffer) {
  const blocks = [];
  let rest = String(buffer ?? "").replace(/\r\n/g, "\n");
  let boundary = rest.indexOf("\n\n");
  while (boundary !== -1) {
    blocks.push(rest.slice(0, boundary));
    rest = rest.slice(boundary + 2);
    boundary = rest.indexOf("\n\n");
  }
  return { blocks, rest };
}

export function sseData(block) {
  return String(block ?? "")
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6))
    .join("");
}

export function muxPayload(envelope) {
  if (!envelope || typeof envelope !== "object") return null;
  return envelope.type === "server-request" ? envelope.payload : envelope;
}

export function muxEventFrame(envelope) {
  const frame = muxPayload(envelope);
  if (frame?.type !== "session/event" || !frame.event) return null;
  return {
    sessionId: frame.sessionId || "",
    event: frame.view ? { ...frame.event, view: frame.view } : frame.event,
  };
}

/**
 * Mux carries session events and answerable waits on the same stream.
 * `question/requested` is replayed on every open; dropping it leaves the turn
 * running with no way to answer.
 */
export function classifyMuxEnvelope(envelope) {
  const frame = muxPayload(envelope);
  if (!frame || typeof frame !== "object") return null;
  const sessionId = frame.sessionId || "";
  const rpcId = typeof envelope?.rpcId === "string" ? envelope.rpcId : "";
  if (frame.type === "session/event" && frame.event) {
    return {
      kind: "event",
      sessionId,
      event: frame.view ? { ...frame.event, view: frame.view } : frame.event,
    };
  }
  if (frame.type === "session/queue") {
    return {
      kind: "queue",
      sessionId,
      items: normalizeQueueItems(frame.items),
    };
  }
  if (frame.type === "session/projection" && typeof frame.key === "string") {
    return {
      kind: "projection",
      sessionId,
      key: frame.key,
      value: frame.value,
      seq: frame.seq,
    };
  }
  if (frame.type === "question/requested") {
    return {
      kind: "question",
      sessionId,
      rpcId,
      questions: Array.isArray(frame.questions) ? frame.questions : [],
    };
  }
  if (frame.type === "approval/requested") {
    return {
      kind: "approval",
      sessionId,
      rpcId,
      approvalId: frame.approvalId,
      toolName: frame.toolName,
      callId: frame.callId,
      reason: frame.reason,
    };
  }
  if (frame.type === "approval/resolved") {
    return {
      kind: "approval-resolved",
      sessionId,
      approvalId: frame.approvalId,
      outcome: frame.outcome,
    };
  }
  if (frame.type === "question/resolved") {
    return {
      kind: "question-resolved",
      sessionId,
      rpcId: frame.questionRpcId || rpcId,
      outcome: frame.outcome,
    };
  }
  return null;
}

export function muxSessionEvent(envelope, sessionId) {
  const frame = muxEventFrame(envelope);
  if (!frame) return null;
  if (sessionId && frame.sessionId !== sessionId) return null;
  return frame.event;
}

function decodeChunk(chunk, decoder) {
  if (typeof chunk === "string") return chunk;
  return decoder.decode(chunk, { stream: true });
}

export async function* iterateSseJson(chunks) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of chunks) {
    buffer += decodeChunk(chunk, decoder);
    const { blocks, rest } = splitSseBlocks(buffer);
    buffer = rest;
    for (const block of blocks) {
      const data = sseData(block);
      if (!data) continue;
      try {
        yield JSON.parse(data);
      } catch {
        // one corrupt frame must not kill the stream
      }
    }
  }
}

export async function* bytesOf(body) {
  if (!body || typeof body.getReader !== "function") return;
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}

export async function* iterateWsJson(socket) {
  const inbox = [];
  let wake;
  const enqueue = (item) => {
    inbox.push(item);
    wake?.();
    wake = undefined;
  };
  const onMessage = (event) => {
    const data = event?.data;
    if (typeof data !== "string") return;
    try {
      enqueue(JSON.parse(data));
    } catch {
      // one corrupt frame must not kill the stream
    }
  };
  const onClose = () => enqueue(null);
  socket.addEventListener("message", onMessage);
  socket.addEventListener("close", onClose, { once: true });
  try {
    while (true) {
      while (inbox.length > 0) {
        const item = inbox.shift();
        if (item === null) return;
        yield item;
      }
      await new Promise((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    socket.removeEventListener("message", onMessage);
    socket.removeEventListener("close", onClose);
  }
}

export async function* consumeMuxInbox(source) {
  const envelopes = typeof source?.getReader === "function"
    ? iterateSseJson(bytesOf(source))
    : iterateWsJson(source);
  for await (const envelope of envelopes) {
    const item = classifyMuxEnvelope(envelope) ?? classifyStreamFrame(envelope);
    if (item) yield item;
  }
}

export async function* consumeMuxFrames(source) {
  for await (const item of consumeMuxInbox(source)) {
    if (item.kind === "event") yield { sessionId: item.sessionId, event: item.event };
  }
}

export async function* consumeMux(source, sessionId) {
  const currentId = () => (typeof sessionId === "function" ? sessionId() : sessionId);
  for await (const frame of consumeMuxFrames(source)) {
    const want = currentId();
    if (want && frame.sessionId !== want) continue;
    yield frame.event;
  }
}
