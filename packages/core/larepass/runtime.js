import { isAuthFailure } from "./host.js";
import { listNavigableSessions, summarizeSession } from "./chat.js";
import {
  classifyRemoteEvent,
  consumeMuxInbox,
  createSessionFollow,
  remoteEventsOpen,
  sessionFollowOpen,
} from "./mux.js";
import { permissionLine, permissionSelect } from "./permissions.js";
import { mintRpcId } from "./rpc.js";
import { sessionReferenceCandidates } from "./references.js";
import { createSessionCache } from "./session-cache.js";
import { createInboxTracker, settleQueueResult } from "./queue.js";
import { foldTranscript } from "./transcript.js";
import { normalizeWorkspaceList, workspaceForSession } from "./workspace.js";

const DRAFT_SESSION = "@lares/draft";
const ACTIVITY_COALESCE_MS = 5000;

function isDraft(sessionId) {
  return sessionId === DRAFT_SESSION;
}

function composerProjections(source) {
  const values = source?.projections?.values ?? {};
  const permissions = permissionSelect(source);
  return {
    permissions: permissions ?? undefined,
    plan: values.plan,
    contextPressure: values.contextPressure,
    contextBreakdown: values.contextBreakdown,
    goal: values.goal,
    todos: values.todos,
    modelSelection: values.modelSelection,
  };
}

function viewOf(state, cache, pendingQuestions, pendingApprovals, inbox) {
  const page = cache.peek(state.sessionId);
  const events = page?.events ?? [];
  const snap = foldTranscript(events);
  const admitted = inbox.pendingUsers(state.sessionId, snap.items);
  const session = state.sessions.find((row) => row.sessionId === state.sessionId);
  return {
    sessionId: isDraft(state.sessionId) ? "" : state.sessionId,
    items: admitted.length ? [...snap.items, ...admitted] : snap.items,
    messages: snap.messages,
    running: snap.running,
    runningSince: snap.runningSince,
    utterance: snap.utterance,
    error: state.error || snap.error,
    failed: state.failed,
    phase: state.phase,
    sessions: state.sessions,
    sessionsReady: state.sessionsReady,
    workspaces: state.workspaces,
    workspacesReady: state.workspacesReady,
    workspaceError: state.workspaceError,
    archivedSessionIds: state.archivedSessionIds,
    historyLoading: Boolean(state.sessionId) && !page?.ready && events.length === 0,
    question: pendingQuestions.get(state.sessionId) ?? null,
    approval: pendingApprovals.get(state.sessionId) ?? null,
    queue: inbox.queue(state.sessionId),
    permissions: permissionSelect(session),
    plan: session?.plan,
    contextPressure: session?.contextPressure,
    contextBreakdown: session?.contextBreakdown,
    goal: session?.goal ?? null,
    todos: session?.todos ?? null,
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
  const pendingQuestions = new Map();
  const pendingApprovals = new Map();
  const inbox = createInboxTracker();
  const projectionSeqs = new Map();
  const state = {
    sessionId: "",
    error: "",
    failed: "",
    phase: "idle",
    sessions: [],
    sessionsReady: false,
    workspaces: [],
    workspacesReady: false,
    workspaceError: "",
    archivedSessionIds: [],
  };
  let liveScroll = { top: 0, stick: true };
  let abort = null;
  let dead = false;
  let muxLoop = null;
  let liveSocket = null;
  let followStreamId = "";
  let followedSessionId = "";
  let followMisses = 0;
  let eventsStreamId = "";
  let eventsClientId = "";
  const follow = createSessionFollow();
  let listing = null;
  let workspaceListing = null;
  let creating = null;

  const emit = () => {
    const view = viewOf(state, cache, pendingQuestions, pendingApprovals, inbox);
    for (const listener of listeners) listener(view);
  };

  function noteFilled(sessionId) {
    const row = state.sessions.find((item) => item.sessionId === sessionId);
    if (!row?.blank) return false;
    row.blank = false;
    return true;
  }

  /**
   * The mux carries events for every session, so a row that is not on screen
   * can be dated here instead of waiting for the next `session.list` — that is
   * what lets an unwatched session show as unseen while it works. Coalesced,
   * because a streaming answer would otherwise re-emit on every token.
   */
  function noteActivity(sessionId, now = Date.now()) {
    if (!sessionId || sessionId === state.sessionId || isDraft(sessionId)) return false;
    const row = state.sessions.find((item) => item.sessionId === sessionId);
    if (!row || now - (Number(row.updatedAt) || 0) < ACTIVITY_COALESCE_MS) return false;
    state.sessions = state.sessions.map((item) => (
      item.sessionId === sessionId ? { ...item, updatedAt: now } : item
    ));
    return true;
  }

  function notePermissions(sessionId, select) {
    if (!sessionId || !select) return false;
    const row = state.sessions.find((item) => item.sessionId === sessionId);
    if (!row || row.permissions?.currentValue === select.currentValue) return false;
    state.sessions = state.sessions.map((item) => (
      item.sessionId === sessionId ? { ...item, permissions: select } : item
    ));
    return true;
  }

  function noteComposerProjections(sessionId, source) {
    if (!sessionId) return false;
    const row = state.sessions.find((item) => item.sessionId === sessionId);
    if (!row) return false;
    const next = composerProjections(source);
    const changed = Object.entries(next).some(([key, value]) => (
      value !== undefined && JSON.stringify(row[key]) !== JSON.stringify(value)
    ));
    if (!changed) return false;
    state.sessions = state.sessions.map((item) => (
      item.sessionId === sessionId
        ? {
            ...item,
            ...Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined)),
          }
        : item
    ));
    return true;
  }

  function ingest(sessionId, extra) {
    const queued = inbox.apply(sessionId, extra);
    const changed = cache.merge(sessionId, extra);
    const filled = extra?.length ? noteFilled(sessionId) : false;
    const moved = extra?.length ? noteActivity(sessionId) : false;
    if (filled || moved || ((changed || queued) && sessionId === state.sessionId)) emit();
  }

  function rememberListed(row) {
    if (!row?.sessionId) return;
    state.sessions = [row, ...state.sessions.filter((item) => item.sessionId !== row.sessionId)];
    state.sessionsReady = true;
  }

  function pullHistory(sessionId) {
    if (!sessionId || dead || isDraft(sessionId)) return Promise.resolve();
    return cache.load(sessionId, async () => {
      const row = state.sessions.find((item) => item.sessionId === sessionId);
      const history = await client.rpc("session.history", {
        sessionId,
        ...(Number.isInteger(row?.asOfSeq) ? { throughSeq: row.asOfSeq } : {}),
      });
      if (dead) return;
      if (!history.ok) {
        if (sessionId !== state.sessionId) return;
        cache.rememberHistory(sessionId, []);
        state.failed = history.error?.message || history.error?.code || "history";
        emit();
        return;
      }
      const events = history.value?.events;
      const seeded = inbox.seed(sessionId, history.value?.projections);
      const queued = inbox.apply(sessionId, events) || seeded;
      const changed = cache.rememberHistory(sessionId, events) || queued;
      const filled = events?.length ? noteFilled(sessionId) : false;
      // The history tail carries the same projections a list row does, and it
      // is the fresher of the two for the session being opened.
      const projected = noteComposerProjections(sessionId, history.value);
      if (filled || projected || (changed && sessionId === state.sessionId)) emit();
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
    liveSocket = typeof opened.body?.send === "function" ? opened.body : null;
    followMisses = 0;
    followStreamId = "";
    followedSessionId = "";
    sendFollow(state.sessionId);
    openEvents();
    try {
      for await (const item of consumeMuxInbox(opened.body)) {
        if (dead) return "stop";
        if (item.kind === "stream" && item.streamId === followStreamId) {
          const step = follow.push(item.value);
          if (step?.ready) followMisses = 0;
          applyFollow(followedSessionId, step);
          continue;
        }
        if ((item.kind === "stream-end" || item.kind === "stream-error") && item.streamId === followStreamId) {
          followStreamId = "";
          followedSessionId = "";
          followMisses += 1;
          void pullHistory(state.sessionId);
          sendFollow(state.sessionId);
          continue;
        }
        if (item.kind === "stream" && item.streamId === eventsStreamId) {
          onRemoteEvent(classifyRemoteEvent(item.value));
          continue;
        }
        if ((item.kind === "stream-end" || item.kind === "stream-error") && item.streamId === eventsStreamId) {
          dropRemoteWaits();
          openEvents();
          continue;
        }
        if (item.kind === "event") {
          ingest(item.sessionId, [item.event]);
          continue;
        }
        if (item.kind === "projection") {
          const projectionKey = `${item.sessionId}\u0000${item.key}`;
          const previousSeq = projectionSeqs.get(projectionKey) ?? -1;
          if (Number.isFinite(item.seq) && item.seq <= previousSeq) continue;
          if (Number.isFinite(item.seq)) projectionSeqs.set(projectionKey, item.seq);
          state.sessions = state.sessions.map((row) => (
            row.sessionId === item.sessionId ? { ...row, [item.key]: item.value } : row
          ));
          if (item.sessionId === state.sessionId) emit();
          continue;
        }
      }
    } catch (err) {
      if (dead || err?.name === "AbortError") return "stop";
      state.failed = err instanceof Error ? err.message : String(err);
      emit();
      return "error";
    } finally {
      if (liveSocket === opened.body) {
        liveSocket = null;
        eventsStreamId = "";
        dropRemoteWaits();
      }
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
      const listed = await listNavigableSessions(client.rpc);
      if (listed.ok) state.sessions = listed.value.items;
      state.sessionsReady = true;
      emit();
      return state.sessions;
    })().finally(() => {
      listing = null;
    });
    return listing;
  }

  async function refreshWorkspaces() {
    if (dead) return state.workspaces;
    if (workspaceListing) return workspaceListing;
    workspaceListing = (async () => {
      const listed = await client.rpc("workspace.list", {});
      if (listed.ok) {
        const normalized = normalizeWorkspaceList(listed.value);
        state.workspaces = normalized.items;
        state.archivedSessionIds = normalized.archivedSessionIds;
        state.workspaceError = "";
      } else {
        state.workspaceError = listed.error?.message || listed.error?.code || "workspace";
      }
      state.workspacesReady = true;
      emit();
      return state.workspaces;
    })().finally(() => {
      workspaceListing = null;
    });
    return workspaceListing;
  }

  function sendFollow(sessionId) {
    const socket = liveSocket;
    if (!socket || socket.readyState !== 1 || !sessionId || isDraft(sessionId)) return;
    if (followedSessionId === sessionId && followStreamId) return;
    if (followMisses > 2) return;
    if (followStreamId) {
      try {
        socket.send(JSON.stringify({ type: "cancel", streamId: followStreamId }));
      } catch {
        // the socket is already closing
      }
    }
    follow.reset();
    followStreamId = mintRpcId();
    followedSessionId = sessionId;
    try {
      socket.send(JSON.stringify(sessionFollowOpen(followStreamId, sessionId)));
    } catch {
      followStreamId = "";
      followedSessionId = "";
    }
  }

  function openEvents() {
    const socket = liveSocket;
    eventsStreamId = "";
    eventsClientId = "";
    if (!socket || socket.readyState !== 1) return;
    eventsStreamId = mintRpcId();
    try {
      socket.send(JSON.stringify(remoteEventsOpen(eventsStreamId)));
    } catch {
      eventsStreamId = "";
    }
  }

  /** A Host delivery dies with the `$events` generation that received it. */
  function dropRemoteWaits() {
    const shown = pendingQuestions.has(state.sessionId) || pendingApprovals.has(state.sessionId);
    pendingQuestions.clear();
    pendingApprovals.clear();
    if (shown) emit();
  }

  function replyRemote(eventId, outcome) {
    if (!eventsClientId) return Promise.resolve({ ok: false, error: { message: "no event stream" } });
    return client.rpc("$events/result", { clientId: eventsClientId, eventId, outcome });
  }

  function onRemoteEvent(item) {
    if (!item) return;
    if (item.kind === "ready") {
      eventsClientId = item.clientId;
      return;
    }
    if (item.kind === "pass") {
      void replyRemote(item.eventId, { kind: "next" });
      return;
    }
    if (item.kind === "question" || item.kind === "approval") {
      (item.kind === "question" ? pendingQuestions : pendingApprovals).set(item.sessionId, item);
      if (item.sessionId === state.sessionId) emit();
      return;
    }
    if (item.kind === "cancel") {
      for (const pending of [pendingQuestions, pendingApprovals]) {
        for (const [sessionId, wait] of pending) {
          if (wait.eventId !== item.eventId) continue;
          pending.delete(sessionId);
          if (sessionId === state.sessionId) emit();
        }
      }
    }
  }

  async function settleRemote(pending, sessionId, value) {
    const wait = pending.get(sessionId);
    if (!wait?.eventId) return { ok: false, error: { message: "not-pending" } };
    const sent = await replyRemote(wait.eventId, { kind: "result", value });
    if (!sent.ok) return { ok: false, error: sent.error };
    if (pending.get(sessionId) === wait) {
      pending.delete(sessionId);
      if (sessionId === state.sessionId) emit();
    }
    return { ok: true };
  }

  function applyFollow(sessionId, step) {
    if (!sessionId || !step) return;
    const dropped = step.dropLive ? cache.dropLive(sessionId) : false;
    const events = step.events ?? [];
    const seeded = inbox.seed(sessionId, step.projections);
    const queued = inbox.apply(sessionId, events) || seeded;
    const changed = step.ready
      ? cache.rememberHistory(sessionId, events)
      : (events.length ? cache.merge(sessionId, events) : false);
    const filled = events.length ? noteFilled(sessionId) : false;
    const projected = step.projections
      ? noteComposerProjections(sessionId, { projections: step.projections })
      : false;
    if (projected || filled || dropped || ((changed || queued) && sessionId === state.sessionId)) emit();
    if (step.resync) void pullHistory(sessionId);
  }

  function occupy(sessionId) {
    state.sessionId = sessionId;
    state.error = "";
    state.failed = "";
    liveScroll = cache.scroll(sessionId);
    emit();
    followMisses = 0;
    sendFollow(sessionId);
  }

  function currentIsEmpty(workspaceId, scoped) {
    if (!state.sessionId || isDraft(state.sessionId)) return false;
    if (scoped) {
      const currentWorkspace = workspaceForSession(state.workspaces, state.sessionId)?.workspaceId;
      if ((currentWorkspace || "") !== (workspaceId || "")) return false;
    }
    const page = cache.peek(state.sessionId);
    return Boolean(page?.ready && page.events.length === 0);
  }

  function reusableBlank(workspaceId, scoped) {
    const target = state.workspaces.find((row) => row.workspaceId === workspaceId);
    const account = scoped && workspaceId ? new Set(target?.sessionIds ?? []) : null;
    const accounted = scoped && !workspaceId
      ? new Set(state.workspaces.flatMap((row) => row.sessionIds ?? []))
      : null;
    return state.sessions.find((row) => {
      if (!row?.blank || !row.sessionId || row.sessionId === state.sessionId) return false;
      if (account && !account.has(row.sessionId)) return false;
      if (accounted && accounted.has(row.sessionId)) return false;
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

  async function createSession(workspaceId = null) {
    if (dead) return;
    if (creating) return creating;
    const scoped = workspaceId !== null;
    const targetWorkspaceId = workspaceId || undefined;
    creating = (async () => {
      if (currentIsEmpty(targetWorkspaceId, scoped)) {
        emit();
        return;
      }
      const blankId = reusableBlank(targetWorkspaceId, scoped);
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
      const opened = await client.rpc(
        "session.create",
        targetWorkspaceId ? { workspaceId: targetWorkspaceId } : {},
      );
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
      if (targetWorkspaceId) {
        state.workspaces = state.workspaces.map((workspace) => (
          workspace.workspaceId === targetWorkspaceId
            ? { ...workspace, sessionIds: [sessionId, ...(workspace.sessionIds ?? []).filter((id) => id !== sessionId)] }
            : workspace
        ));
      }
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
    snapshot: () => viewOf(state, cache, pendingQuestions, pendingApprovals, inbox),
    subscribe(listener) {
      listeners.add(listener);
      listener(viewOf(state, cache, pendingQuestions, pendingApprovals, inbox));
      return () => listeners.delete(listener);
    },
    async start(options = {}) {
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
      if (options.workspaces === true) {
        await Promise.all([refreshSessions(), refreshWorkspaces()]);
        const existing = state.sessions[0];
        if (existing?.sessionId) {
          state.sessionId = existing.sessionId;
          liveScroll = cache.scroll(state.sessionId);
          await pullHistory(state.sessionId);
          ensureMux();
          emit();
          return;
        }
        const workspaceId = state.workspaces[0]?.workspaceId;
        if (workspaceId) {
          await createSession(workspaceId);
          emit();
          return;
        }
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
    refreshWorkspaces,
    async listSessions() {
      if (state.sessionsReady) {
        refreshSessions();
        return state.sessions;
      }
      return refreshSessions();
    },
    openSession,
    createSession,
    async searchSessions(query) {
      return client.rpc("session.search", { query });
    },
    async renameSession(sessionId, title) {
      const renamed = await client.rpc("session.rename", { sessionId, title });
      if (!renamed.ok) return renamed;
      state.sessions = state.sessions.map((row) => (
        row.sessionId === sessionId ? { ...row, title: renamed.value?.title || title } : row
      ));
      emit();
      return renamed;
    },
    async forkSession(sessionId) {
      if (!sessionId || isDraft(sessionId)) {
        return { ok: false, error: { code: "no_session", message: "no session" } };
      }
      const forked = await client.rpc("session.fork", { sessionId });
      const childId = forked.ok ? forked.value?.sessionId : "";
      if (!childId) {
        const failure = forked.ok
          ? { ok: false, error: { code: "fork", message: "fork returned no session" } }
          : forked;
        if (dead) return failure;
        state.failed = failure.error?.message || failure.error?.code || "fork";
        emit();
        return failure;
      }
      // The child's title, order and workspace are decided host-side, so re-read
      // whichever lists this runtime tracks rather than guessing them locally.
      await Promise.all([refreshSessions(), state.workspacesReady ? refreshWorkspaces() : null]);
      await openSession(childId);
      return forked;
    },
    async createWorkspace(path) {
      const created = await client.rpc("workspace.create", { path });
      if (!created.ok) return created;
      const workspace = created.value?.workspace;
      if (workspace) {
        state.workspaces = [
          workspace,
          ...state.workspaces.filter((row) => row.workspaceId !== workspace.workspaceId),
        ];
        state.workspacesReady = true;
        emit();
      }
      return created;
    },
    async renameWorkspace(workspaceId, title) {
      const renamed = await client.rpc("workspace.rename", { workspaceId, title });
      if (!renamed.ok) return renamed;
      const workspace = renamed.value?.workspace;
      if (workspace) {
        state.workspaces = state.workspaces.map((row) => (
          row.workspaceId === workspaceId ? workspace : row
        ));
        emit();
      }
      return renamed;
    },
    async deleteWorkspace(workspaceId) {
      const deleted = await client.rpc("workspace.delete", { workspaceId });
      if (!deleted.ok) return deleted;
      state.workspaces = state.workspaces.filter((row) => row.workspaceId !== workspaceId);
      emit();
      return deleted;
    },
    async insertWorkspaceBefore(workspaceId, beforeWorkspaceId) {
      const moved = await client.rpc("workspace.insertBefore", {
        workspaceId,
        ...(beforeWorkspaceId ? { beforeWorkspaceId } : {}),
      });
      if (!moved.ok) return moved;
      const byId = new Map(state.workspaces.map((row) => [row.workspaceId, row]));
      state.workspaces = (moved.value?.workspaceIds ?? []).map((id) => byId.get(id)).filter(Boolean);
      emit();
      return moved;
    },
    async insertSessionBefore(workspaceId, sessionId, beforeSessionId) {
      const moved = await client.rpc("workspace.insertSessionBefore", {
        workspaceId,
        sessionId,
        ...(beforeSessionId ? { beforeSessionId } : {}),
      });
      if (!moved.ok) return moved;
      const workspace = moved.value?.workspace;
      if (workspace) {
        state.workspaces = state.workspaces.map((row) => (
          row.workspaceId === workspaceId ? workspace : row
        ));
        emit();
      }
      return moved;
    },
    async archiveSession(sessionId) {
      const archived = await client.rpc("workspace.archiveSession", { sessionId });
      if (!archived.ok) return archived;
      state.archivedSessionIds = archived.value?.archivedSessionIds ?? state.archivedSessionIds;
      emit();
      return archived;
    },
    async refreshModelCatalog() {
      await client.settings.refreshModels();
    },
    modelCatalog() {
      return client.rpc("session.modelCatalog");
    },
    selectModel(selection) {
      const sessionId = state.sessionId;
      if (!sessionId || isDraft(sessionId)) {
        return Promise.resolve({ ok: false, error: { code: "no_session", message: "no session" } });
      }
      return client.rpc("session.selectModel", { sessionId, ...selection }).then((result) => {
        const selected = result.ok ? result.value?.selected : null;
        if (selected) {
          const row = state.sessions.find((item) => item.sessionId === sessionId);
          noteComposerProjections(sessionId, {
            projections: {
              values: {
                modelSelection: {
                  lastUsed: row?.modelSelection?.lastUsed ?? null,
                  next: selected,
                },
              },
            },
          });
          emit();
        }
        return result;
      });
    },
    cancel() {
      const sessionId = state.sessionId;
      if (!sessionId || isDraft(sessionId)) {
        return Promise.resolve({ ok: false, error: { code: "no_session", message: "no session" } });
      }
      return client.rpc("session.cancel", { sessionId });
    },
    updateQueue(itemId, action) {
      const sessionId = state.sessionId;
      if (!sessionId || isDraft(sessionId) || !itemId) {
        return Promise.resolve({ ok: false, error: { code: "no_session", message: "no session" } });
      }
      return client.rpc("session.updateQueue", { sessionId, itemId, action }).then(settleQueueResult);
    },
    listDirectory(path) {
      return client.rpc("host.listDirectory", path ? { path } : {});
    },
    createDirectory(path, name) {
      return client.rpc("host.createDirectory", { path, name });
    },
    /**
     * The preset is switched with the host's own `/permission` command; there
     * is no RPC for it. The projection behind the chip is recomputed host-side,
     * so the switch shows at once and the following list read confirms it.
     */
    async setPermission(value) {
      const sessionId = state.sessionId;
      if (!value || !sessionId || isDraft(sessionId)) {
        return { ok: false, error: { code: "no_session", message: "no session" } };
      }
      const sent = await client.prompt(sessionId, permissionLine(value));
      if (!sent.ok || dead) return sent;
      const current = permissionSelect(state.sessions.find((row) => row.sessionId === sessionId));
      if (current) notePermissions(sessionId, { ...current, currentValue: value });
      emit();
      void refreshSessions();
      return sent;
    },
    listCommands() {
      if (typeof client.commands !== "function") return Promise.resolve([]);
      return client.commands(state.sessionId);
    },
    async listReferences(query, quoted = false) {
      if (!state.sessionId || isDraft(state.sessionId)) return [];
      const files = typeof client.references === "function"
        ? await client.references(state.sessionId, query, quoted)
        : [];
      if (quoted) return files.filter((row) => row.kind !== "session");
      const sessions = sessionReferenceCandidates(state.sessions, state.sessionId, query);
      const fileRows = files.filter((row) => row.kind !== "session");
      return [...fileRows, ...sessions];
    },
    runCommand(line) {
      if (!state.sessionId || isDraft(state.sessionId)) {
        return Promise.resolve({ ok: false, error: { message: "no session" } });
      }
      return client.prompt(state.sessionId, line);
    },
    goalAction(kind, value) {
      const sessionId = state.sessionId;
      const projection = state.sessions.find((row) => row.sessionId === sessionId)?.goal;
      const ref = projection?.goal
        ? { id: projection.goal.id, revision: projection.goal.revision }
        : null;
      if (!sessionId || isDraft(sessionId) || !ref || !["edit", "pause", "resume", "clear"].includes(kind)) {
        return Promise.resolve({ ok: false, error: { code: "no-current-goal", message: "no current goal" } });
      }
      return client.rpc(`goal.${kind}`, {
        sessionId,
        ref,
        ...(kind === "edit" ? { objective: String(value ?? "") } : {}),
      });
    },
    async send(content, mode = "queue") {
      if (!state.sessionId || isDraft(state.sessionId)) {
        return { ok: false, error: { message: "no session" } };
      }
      return client.prompt(state.sessionId, content, mode);
    },
    answerQuestion(answers) {
      return settleRemote(pendingQuestions, state.sessionId, { answers });
    },
    answerApproval(outcome) {
      return settleRemote(pendingApprovals, state.sessionId, outcome === "allowed-once" ? "allowed-once" : "rejected");
    },
    preview(path) {
      if (!state.sessionId || typeof client.preview !== "function") {
        return Promise.reject(new Error("file_preview_failed"));
      }
      return client.preview(state.sessionId, path);
    },
    mediaUrl(path, modifiedAt, size) {
      return client.mediaUrl?.(state.sessionId, path, modifiedAt, size) ?? "";
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
    voiceSocket(ticket, path) { return client.voiceSocket(ticket, path); },
    voiceRequest(path, options) { return client.voiceRequest(path, options); },
    transcribe(blob, language, signal, model) {
      if (typeof client.transcribe !== "function") {
        return Promise.reject(new Error("voice_failed"));
      }
      return client.transcribe(blob, language, signal, model);
    },
    reportLog(scope, event, fields) {
      if (typeof client.reportLog !== "function") return Promise.resolve(false);
      return client.reportLog(scope, event, fields);
    },
    speak(request) {
      if (typeof client.speak !== "function") return Promise.resolve(null);
      return client.speak(request);
    },
    interruptSpeech() {
      if (typeof client.interruptSpeech !== "function") return Promise.resolve(false);
      return client.interruptSpeech();
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
      workspaceListing = null;
      creating = null;
      cache.clear();
      pendingQuestions.clear();
      listeners.clear();
    },
  };
}
