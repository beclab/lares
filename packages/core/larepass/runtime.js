import { isAuthFailure } from "./host.js";
import { listRootSessions, summarizeSession } from "./chat.js";
import { consumeMuxFrames } from "./mux.js";
import { createSessionCache } from "./session-cache.js";
import { foldTranscript } from "./transcript.js";

const DRAFT_SESSION = "@lares/draft";

function isDraft(sessionId) {
  return sessionId === DRAFT_SESSION;
}

function viewOf(state, cache) {
  const page = cache.peek(state.sessionId);
  const events = page?.events ?? [];
  const snap = foldTranscript(events);
  return {
    sessionId: isDraft(state.sessionId) ? "" : state.sessionId,
    items: snap.items,
    messages: snap.messages,
    running: snap.running,
    error: state.error || snap.error,
    failed: state.failed,
    phase: state.phase,
    sessions: state.sessions,
    sessionsReady: state.sessionsReady,
    historyLoading: Boolean(state.sessionId) && !page?.ready && events.length === 0,
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
  const cache = createSessionCache();
  const state = {
    sessionId: "",
    error: "",
    failed: "",
    phase: "idle",
    sessions: [],
    sessionsReady: false,
  };
  let liveScroll = { top: 0, stick: true };
  let abort = null;
  let dead = false;
  let muxLoop = null;
  let listing = null;
  let creating = null;

  const emit = () => {
    const view = viewOf(state, cache);
    for (const listener of listeners) listener(view);
  };

  function noteFilled(sessionId) {
    const row = state.sessions.find((item) => item.sessionId === sessionId);
    if (!row?.blank) return false;
    row.blank = false;
    return true;
  }

  function ingest(sessionId, extra) {
    const changed = cache.merge(sessionId, extra);
    const filled = extra?.length ? noteFilled(sessionId) : false;
    if (filled || (changed && sessionId === state.sessionId)) emit();
  }

  function rememberListed(row) {
    if (!row?.sessionId) return;
    state.sessions = [row, ...state.sessions.filter((item) => item.sessionId !== row.sessionId)];
    state.sessionsReady = true;
  }

  function pullHistory(sessionId) {
    if (!sessionId || dead || isDraft(sessionId)) return Promise.resolve();
    return cache.load(sessionId, async () => {
      const history = await client.rpc("session.history", { sessionId });
      if (dead) return;
      if (!history.ok) {
        if (sessionId !== state.sessionId) return;
        cache.rememberHistory(sessionId, []);
        state.failed = history.error?.message || history.error?.code || "history";
        emit();
        return;
      }
      const events = history.value?.events;
      const changed = cache.rememberHistory(sessionId, events);
      const filled = events?.length ? noteFilled(sessionId) : false;
      if (filled || (changed && sessionId === state.sessionId)) emit();
    });
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
      for await (const frame of consumeMuxFrames(opened.body)) {
        if (dead) return "stop";
        ingest(frame.sessionId, [frame.event]);
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
      await pullHistory(state.sessionId);
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    muxLoop = null;
  }

  function ensureMux() {
    if (dead || muxLoop || !state.sessionId) return;
    state.phase = "live";
    muxLoop = listenLoop();
  }

  async function refreshSessions() {
    if (dead) return state.sessions;
    if (listing) return listing;
    listing = (async () => {
      const listed = await listRootSessions(client.rpc);
      if (listed.ok) state.sessions = listed.value.items;
      state.sessionsReady = true;
      emit();
      return state.sessions;
    })().finally(() => {
      listing = null;
    });
    return listing;
  }

  function occupy(sessionId) {
    state.sessionId = sessionId;
    state.error = "";
    state.failed = "";
    liveScroll = cache.scroll(sessionId);
    emit();
  }

  function currentIsEmpty() {
    if (!state.sessionId || isDraft(state.sessionId)) return false;
    const page = cache.peek(state.sessionId);
    return Boolean(page?.ready && page.events.length === 0);
  }

  function reusableBlank() {
    return state.sessions.find((row) => {
      if (!row?.blank || !row.sessionId || row.sessionId === state.sessionId) return false;
      const page = cache.peek(row.sessionId);
      return !page || page.events.length === 0;
    })?.sessionId;
  }

  async function openSession(sessionId) {
    if (!sessionId || dead || isDraft(sessionId)) return;
    if (sessionId === state.sessionId) {
      emit();
      return;
    }
    occupy(sessionId);
    if (!cache.ready(sessionId)) await pullHistory(sessionId);
    ensureMux();
  }

  async function createSession() {
    if (dead) return;
    if (creating) return creating;
    creating = (async () => {
      if (currentIsEmpty()) {
        emit();
        return;
      }
      const blankId = reusableBlank();
      if (blankId) {
        cache.readyEmpty(blankId);
        occupy(blankId);
        ensureMux();
        pullHistory(blankId);
        return;
      }
      const previous = state.sessionId;
      cache.readyEmpty(DRAFT_SESSION);
      occupy(DRAFT_SESSION);
      ensureMux();
      const opened = await client.rpc("session.create", {});
      if (dead) return;
      if (!opened.ok) {
        cache.drop(DRAFT_SESSION);
        if (state.sessionId !== DRAFT_SESSION) return;
        if (previous) occupy(previous);
        state.failed = opened.error?.message || opened.error?.code || "session";
        emit();
        return;
      }
      const sessionId = opened.value.sessionId;
      cache.readyEmpty(sessionId);
      rememberListed(summarizeSession({ ...opened.value, sessionId, blank: true }));
      cache.drop(DRAFT_SESSION);
      if (state.sessionId !== DRAFT_SESSION && state.sessionId !== sessionId) return;
      occupy(sessionId);
      ensureMux();
    })().finally(() => {
      creating = null;
    });
    return creating;
  }

  return {
    snapshot: () => viewOf(state, cache),
    subscribe(listener) {
      listeners.add(listener);
      listener(viewOf(state, cache));
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
      liveScroll = cache.scroll(state.sessionId);
      const listed = Array.isArray(opened.value.sessions)
        ? (state.sessions = opened.value.sessions, state.sessionsReady = true, Promise.resolve(state.sessions))
        : refreshSessions();
      await Promise.all([pullHistory(state.sessionId), listed]);
      ensureMux();
      emit();
    },
    refreshSessions,
    async listSessions() {
      if (state.sessionsReady) {
        refreshSessions();
        return state.sessions;
      }
      return refreshSessions();
    },
    openSession,
    createSession,
    async send(text) {
      if (!state.sessionId || isDraft(state.sessionId)) {
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
    upload(file, options, sessionId = state.sessionId) {
      const id = sessionId || state.sessionId;
      if (!id || isDraft(id) || typeof client.upload !== "function") {
        return Promise.reject(new Error("file_upload_failed"));
      }
      return client.upload(id, file, options);
    },
    transcribe(blob, language, signal) {
      if (typeof client.transcribe !== "function") {
        return Promise.reject(new Error("voice_failed"));
      }
      return client.transcribe(blob, language, signal);
    },
    settings: client.settings,
    rememberScroll(top, height, view) {
      if (view <= 0) return;
      liveScroll = pinnedScroll(top, height, view);
      if (state.sessionId) cache.setScroll(state.sessionId, liveScroll);
    },
    pinToBottom() {
      liveScroll = { top: 0, stick: true };
      if (state.sessionId) cache.setScroll(state.sessionId, liveScroll);
    },
    sticking() {
      return (state.sessionId ? cache.scroll(state.sessionId) : liveScroll).stick !== false;
    },
    scrollTop(height, view) {
      if (view <= 0) return null;
      const saved = state.sessionId ? cache.peek(state.sessionId)?.scroll ?? liveScroll : liveScroll;
      return restoreScroll(saved, height, view);
    },
    dispose() {
      dead = true;
      abort?.abort();
      muxLoop = null;
      listing = null;
      creating = null;
      cache.clear();
      listeners.clear();
    },
  };
}
