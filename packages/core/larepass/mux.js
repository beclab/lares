export const MUX_PATH = "/api/events.mux";

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

export function muxEventFrame(envelope) {
  const frame = envelope?.type === "server-request" ? envelope.payload : envelope;
  if (frame?.type !== "session/event" || !frame.event) return null;
  return {
    sessionId: frame.sessionId || "",
    event: frame.view ? { ...frame.event, view: frame.view } : frame.event,
  };
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

export async function* consumeMuxFrames(source) {
  const envelopes = typeof source?.getReader === "function"
    ? iterateSseJson(bytesOf(source))
    : iterateWsJson(source);
  for await (const envelope of envelopes) {
    const frame = muxEventFrame(envelope);
    if (frame) yield frame;
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
