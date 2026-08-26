const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_CONCURRENCY = 3;

function freshId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function failureCode(error) {
  if (error?.name === "AbortError") return "file_upload_cancelled";
  return error instanceof Error ? error.message : "file_upload_failed";
}

export function splitComposerFiles(files) {
  const images = [];
  const documents = [];
  for (const file of files) {
    (IMAGE_TYPES.has(file.type) ? images : documents).push(file);
  }
  return { images, documents };
}

export function documentPasteFiles(clipboardData) {
  const files = Array.from(clipboardData?.files ?? []);
  return splitComposerFiles(files).documents.length > 0 ? files : null;
}

export function partitionDocumentsBySize(documents, maxBytes) {
  const accepted = [];
  const oversized = [];
  for (const file of documents) {
    if (file.size > maxBytes) oversized.push(file);
    else accepted.push(file);
  }
  return { accepted, oversized };
}

export class FileIntake {
  constructor(upload) {
    this.upload = upload;
    this.sessions = new Map();
  }

  session(sessionId) {
    let state = this.sessions.get(sessionId);
    if (state) return state;
    state = {
      items: [],
      listeners: new Set(),
      snapshot: { pending: 0, failures: [] },
    };
    this.sessions.set(sessionId, state);
    return state;
  }

  getSnapshot(sessionId) {
    return this.session(sessionId).snapshot;
  }

  subscribe(sessionId, listener) {
    const state = this.session(sessionId);
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  }

  publish(state) {
    state.snapshot = {
      pending: state.items.filter((item) => item.status === "uploading").length,
      failures: state.items
        .filter((item) => item.status === "failed")
        .map(({ id, file, code }) => ({ id, name: file.name || "file", code })),
    };
    for (const listener of state.listeners) listener();
  }

  reportFailure(sessionId, file, code) {
    const state = this.session(sessionId);
    state.items.push({
      id: freshId(),
      file,
      status: "failed",
      code,
      controller: null,
    });
    this.publish(state);
  }

  dismiss(sessionId, itemId) {
    const state = this.session(sessionId);
    state.items = state.items.filter((item) => item.id !== itemId);
    this.publish(state);
  }

  async uploadFiles(sessionId, files, commit) {
    if (files.length === 0) return;
    const state = this.session(sessionId);
    const items = files.map((file) => ({
      id: freshId(),
      requestId: freshId(),
      file,
      status: "uploading",
      code: null,
      controller: new AbortController(),
    }));
    state.items.push(...items);
    this.publish(state);

    let cursor = 0;
    const successful = new Array(items.length);
    const worker = async () => {
      while (cursor < items.length) {
        const index = cursor++;
        const item = items[index];
        try {
          const result = await this.upload(item.file, sessionId, {
            signal: item.controller.signal,
            requestId: item.requestId,
          });
          if (!item.controller.signal.aborted) successful[index] = { item, result };
        } catch (error) {
          if (!item.controller.signal.aborted) {
            item.status = "failed";
            item.code = failureCode(error);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, items.length) }, worker));

    const live = this.sessions.get(sessionId);
    if (live !== state) return;
    const committed = successful.filter(Boolean);
    const paths = committed.map(({ result }) => result.path);
    if (paths.length > 0) commit(paths);
    const completed = new Set(committed.map(({ item }) => item));
    state.items = state.items.filter((item) => {
      if (completed.has(item)) return false;
      if (item.controller?.signal.aborted) return false;
      return true;
    });
    this.publish(state);
  }

  retry(sessionId, itemId, commit) {
    const state = this.session(sessionId);
    const item = state.items.find((candidate) => candidate.id === itemId && candidate.status === "failed");
    if (!item) return Promise.resolve();
    state.items = state.items.filter((candidate) => candidate !== item);
    return this.uploadFiles(sessionId, [item.file], commit);
  }

  cancelSession(sessionId) {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    for (const item of state.items) item.controller?.abort();
    state.items = [];
    this.publish(state);
  }
}
