import { isAuthFailure } from "./host.js";
import { foldTranscript, mergeEvents } from "./transcript.js";

function viewOf(state) {
  const snap = foldTranscript(state.events);
  return {
    sessionId: state.sessionId,
    items: snap.items,
    messages: snap.messages,
    running: snap.running,
    error: state.error || snap.error,
    failed: state.failed,
    phase: state.phase,
  };
}

export function pinnedScroll(top, height, view, slop = 48) {
  if (height <= view) return { top: 0, stick: true };
  return { top, stick: height - view - top <= slop };
}

export function restoreScroll(saved, height, view) {
  if (!saved || saved.stick) return Math.max(0, height - view);
  return Math.min(Math.max(0, saved.top), Math.max(0, height - view));
}

export function createChatRuntime(client) {
  const listeners = new Set();
  const state = {
    sessionId: "",
    events: [],
    error: "",
    failed: "",
    phase: "idle",
    scroll: { top: 0, stick: true },
  };
  let abort = null;
  let dead = false;
  let muxLoop = null;

  const emit = () => {
    const view = viewOf(state);
    for (const listener of listeners) listener(view);
  };

  const ingest = (extra) => {
    state.events = mergeEvents(state.events, extra);
    const snap = foldTranscript(state.events);
    if (snap.error) state.error = snap.error;
    emit();
  };

  async function pullHistory() {
    if (!state.sessionId) return;
    const history = await client.rpc("session.history", { sessionId: state.sessionId });
    if (!history.ok) {
      state.failed = history.error?.message || history.error?.code || "history";
      emit();
      return;
    }
    ingest(history.value?.events);
  }

  async function listenOnce() {
    abort?.abort();
    abort = new AbortController();
    const opened = await client.openMux(abort.signal);
    if (isAuthFailure(opened.http)) {
      state.failed = "unauthorized";
      emit();
      return "unauthorized";
    }
    if (!opened.ok || !opened.body) {
      state.failed = opened.error?.message || `mux ${opened.http || opened.status || ""}`;
      emit();
      return "error";
    }
    state.failed = "";
    emit();
    try {
      for await (const event of client.consumeMux(opened.body, state.sessionId)) {
        if (dead) return "stop";
        ingest([event]);
      }
    } catch (err) {
      if (dead || err?.name === "AbortError") return "stop";
      state.failed = err instanceof Error ? err.message : String(err);
      emit();
      return "error";
    }
    return "end";
  }

  async function listenLoop() {
    while (!dead && state.sessionId) {
      const result = await listenOnce();
      if (result === "unauthorized") {
        state.phase = "idle";
        muxLoop = null;
        return;
      }
      if (dead || result === "stop") {
        if (state.phase === "live") state.phase = "stale";
        muxLoop = null;
        return;
      }
      await pullHistory();
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    muxLoop = null;
  }

  function ensureMux() {
    if (dead || muxLoop || !state.sessionId) return;
    state.phase = "live";
    muxLoop = listenLoop();
  }

  return {
    snapshot: () => viewOf(state),
    subscribe(listener) {
      listeners.add(listener);
      listener(viewOf(state));
      return () => listeners.delete(listener);
    },
    async start() {
      if (dead) return;
      if (state.phase === "starting") return;
      if (state.phase === "live" && muxLoop) return;
      if (state.sessionId && (state.phase === "live" || state.phase === "stale")) {
        ensureMux();
        emit();
        return;
      }
      state.phase = "starting";
      state.failed = "";
      emit();
      const probe = await client.probe();
      if (probe.status !== "ok") {
        state.phase = "idle";
        state.failed = probe.status;
        emit();
        return;
      }
      const opened = await client.ensureSession();
      if (!opened.ok) {
        state.phase = "idle";
        state.failed = opened.error?.message || opened.error?.code || "session";
        emit();
        return;
      }
      state.sessionId = opened.value.sessionId;
      await pullHistory();
      ensureMux();
      emit();
    },
    async send(text) {
      if (!state.sessionId) {
        return { ok: false, error: { message: "no session" } };
      }
      return client.prompt(state.sessionId, text);
    },
    preview(path) {
      if (!state.sessionId || typeof client.preview !== "function") {
        return Promise.reject(new Error("file_preview_failed"));
      }
      return client.preview(state.sessionId, path);
    },
    mediaUrl(path, modifiedAt) {
      return client.mediaUrl?.(state.sessionId, path, modifiedAt) ?? "";
    },
    downloadUrl(path) {
      return client.downloadUrl?.(state.sessionId, path) ?? "";
    },
    rememberScroll(top, height, view) {
      if (view <= 0) return;
      state.scroll = pinnedScroll(top, height, view);
    },
    pinToBottom() {
      state.scroll = { top: 0, stick: true };
    },
    sticking() {
      return state.scroll.stick !== false;
    },
    scrollTop(height, view) {
      if (view <= 0) return null;
      return restoreScroll(state.scroll, height, view);
    },
    dispose() {
      dead = true;
      abort?.abort();
      muxLoop = null;
      listeners.clear();
    },
  };
}
