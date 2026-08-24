const MAX_TABS = 8;

function fileName(path) {
  const parts = String(path).split(/[/\\]/);
  return parts.at(-1) || path;
}

function initialSnapshot() {
  return {
    mode: "chat",
    tabs: [],
    activePath: null,
    content: { status: "idle" },
    evictedName: null,
  };
}

function errorCode(payload) {
  return payload?.error?.code || "file_preview_failed";
}

async function fetchPreview(sessionId, path) {
  const query = new URLSearchParams({ sessionId, path });
  const response = await fetch(`/api/lares/file-preview/preview?${query}`);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorCode(payload));
  return payload;
}

export function rawFileUrl(sessionId, path) {
  const query = new URLSearchParams({ sessionId, path });
  return `/api/lares/file-preview/raw?${query}`;
}

export class FilePreviewWorkspace {
  constructor() {
    this.sessions = new Map();
    this.current = null;
  }

  session(sessionId) {
    let state = this.sessions.get(sessionId);
    if (state) return state;
    state = {
      snapshot: initialSnapshot(),
      lru: [],
      contents: new Map(),
      listeners: new Set(),
      requestVersions: new Map(),
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

  bindCurrent(sessionId) {
    const binding = { sessionId };
    this.current = binding;
    return () => {
      if (this.current === binding) this.current = null;
    };
  }

  openCurrent(path) {
    if (!this.current) return false;
    this.open(this.current.sessionId, path);
    return true;
  }

  showChat(sessionId) {
    this.emit(sessionId, { mode: "chat", evictedName: null });
  }

  open(sessionId, path) {
    const state = this.session(sessionId);
    const existing = state.snapshot.tabs.find((tab) => tab.path === path);
    let tabs = state.snapshot.tabs;
    let evictedName = null;
    if (!existing) {
      if (tabs.length >= MAX_TABS) {
        const victim = state.lru[0];
        const evicted = tabs.find((tab) => tab.path === victim);
        tabs = tabs.filter((tab) => tab.path !== victim);
        state.lru = state.lru.filter((item) => item !== victim);
        state.contents.delete(victim);
        state.requestVersions.delete(victim);
        evictedName = evicted?.name ?? null;
      }
      tabs = [...tabs, { path, name: fileName(path) }];
    }
    this.touch(state, path);
    this.emit(sessionId, {
      mode: "preview",
      tabs,
      activePath: path,
      content: state.contents.get(path) ?? { status: "idle" },
      evictedName,
    });
    void this.load(sessionId, path);
  }

  activate(sessionId, path) {
    const state = this.session(sessionId);
    if (!state.snapshot.tabs.some((tab) => tab.path === path)) return;
    this.touch(state, path);
    this.emit(sessionId, {
      mode: "preview",
      activePath: path,
      content: state.contents.get(path) ?? { status: "idle" },
      evictedName: null,
    });
    void this.load(sessionId, path);
  }

  close(sessionId, path) {
    const state = this.session(sessionId);
    if (!state.snapshot.tabs.some((tab) => tab.path === path)) return;
    const tabs = state.snapshot.tabs.filter((tab) => tab.path !== path);
    state.lru = state.lru.filter((item) => item !== path);
    state.contents.delete(path);
    state.requestVersions.set(path, (state.requestVersions.get(path) ?? 0) + 1);
    if (tabs.length === 0) {
      this.emit(sessionId, {
        mode: "chat",
        tabs,
        activePath: null,
        content: { status: "idle" },
        evictedName: null,
      });
      return;
    }
    if (state.snapshot.activePath !== path) {
      this.emit(sessionId, { tabs, evictedName: null });
      return;
    }
    const activePath = state.lru.at(-1) ?? tabs.at(-1).path;
    this.emit(sessionId, {
      tabs,
      activePath,
      content: state.contents.get(activePath) ?? { status: "idle" },
      evictedName: null,
    });
    void this.load(sessionId, activePath);
  }

  clearEvicted(sessionId) {
    this.emit(sessionId, { evictedName: null });
  }

  retry(sessionId, path) {
    const state = this.session(sessionId);
    state.contents.delete(path);
    void this.load(sessionId, path);
  }

  touch(state, path) {
    state.lru = state.lru.filter((item) => item !== path);
    state.lru.push(path);
  }

  async load(sessionId, path) {
    const state = this.session(sessionId);
    const current = state.contents.get(path);
    if (current?.status === "ready" || current?.status === "loading") return;
    const version = (state.requestVersions.get(path) ?? 0) + 1;
    state.requestVersions.set(path, version);
    state.contents.set(path, { status: "loading" });
    if (state.snapshot.activePath === path) this.emit(sessionId, { content: { status: "loading" } });
    try {
      const data = await fetchPreview(sessionId, path);
      if (state.requestVersions.get(path) !== version) return;
      const content = { status: "ready", data };
      state.contents.set(path, content);
      if (state.snapshot.activePath === path) this.emit(sessionId, { content });
    } catch (error) {
      if (state.requestVersions.get(path) !== version) return;
      const content = {
        status: "error",
        message: error instanceof Error ? error.message : "file_preview_failed",
      };
      state.contents.set(path, content);
      if (state.snapshot.activePath === path) this.emit(sessionId, { content });
    }
  }

  emit(sessionId, patch) {
    const state = this.session(sessionId);
    state.snapshot = { ...state.snapshot, ...patch };
    for (const listener of state.listeners) listener();
  }
}
