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

export async function fetchPreview(sessionId, path) {
  const query = new URLSearchParams({ sessionId, path });
  const response = await fetch(`/api/lares/file-preview/preview?${query}`);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorCode(payload));
  return payload;
}

const RAW_ROUTE = "/api/lares/file-preview/raw";

export function rawFileUrl(sessionId, path) {
  const query = new URLSearchParams({ sessionId, path });
  return `${RAW_ROUTE}?${query}`;
}

/** Absolute form: markdown targets survive the renderer only as full URLs. */
export function rawFileHref(sessionId, path) {
  return new URL(rawFileUrl(sessionId, path), window.location.origin).href;
}

/**
 * The workspace path behind a raw URL this session owns, or null for anything
 * else — the seam that turns a rewritten markdown target back into a preview.
 */
export function rawUrlPath(sessionId, href) {
  let url;
  try {
    url = new URL(href, window.location.origin);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin || url.pathname !== RAW_ROUTE) return null;
  if (url.searchParams.get("sessionId") !== sessionId) return null;
  return url.searchParams.get("path");
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
      offsets: new Map(),
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

  /**
   * Claim a Host open request, or decline it. The preview serves regular files
   * only, so the target is resolved before any tab exists: a directory stays
   * with the Host's own opener instead of becoming a tab that can never load.
   */
  async openCurrent(path) {
    if (!this.current) return false;
    const { sessionId } = this.current;
    const known = this.session(sessionId).contents.get(path);
    if (known?.status === "ready") {
      this.open(sessionId, path, known);
      return true;
    }
    const content = await this.fetchContent(sessionId, path);
    if (content.status === "error" && content.message === "path_not_file") return false;
    this.open(sessionId, path, content);
    return true;
  }

  showChat(sessionId) {
    this.emit(sessionId, { mode: "chat", evictedName: null });
  }

  /** @param resolved - content the caller already fetched; absent loads it here. */
  open(sessionId, path, resolved) {
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
        state.offsets.delete(victim);
        state.requestVersions.delete(victim);
        evictedName = evicted?.name ?? null;
      }
      tabs = [...tabs, { path, name: fileName(path) }];
    }
    if (resolved !== undefined) {
      state.contents.set(path, resolved);
      state.requestVersions.set(path, (state.requestVersions.get(path) ?? 0) + 1);
    }
    this.touch(state, path);
    this.emit(sessionId, {
      mode: "preview",
      tabs,
      activePath: path,
      content: state.contents.get(path) ?? { status: "idle" },
      evictedName,
    });
    if (resolved === undefined) void this.load(sessionId, path);
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
    state.offsets.delete(path);
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

  /**
   * Where a tab was scrolled to. The scrolling element belongs to whichever kind
   * is on screen, so it does not outlive the tab: the offset lives here for the
   * tab's lifetime instead. It stays out of the snapshot — scrolling must not
   * re-render the view.
   */
  scrollOffset(sessionId, path) {
    return this.session(sessionId).offsets.get(path) ?? 0;
  }

  rememberScroll(sessionId, path, offset) {
    this.session(sessionId).offsets.set(path, offset);
  }

  async fetchContent(sessionId, path) {
    try {
      return { status: "ready", data: await fetchPreview(sessionId, path) };
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : "file_preview_failed",
      };
    }
  }

  async load(sessionId, path) {
    const state = this.session(sessionId);
    const current = state.contents.get(path);
    if (current?.status === "ready" || current?.status === "loading") return;
    const version = (state.requestVersions.get(path) ?? 0) + 1;
    state.requestVersions.set(path, version);
    state.contents.set(path, { status: "loading" });
    if (state.snapshot.activePath === path) this.emit(sessionId, { content: { status: "loading" } });
    const content = await this.fetchContent(sessionId, path);
    if (state.requestVersions.get(path) !== version) return;
    state.contents.set(path, content);
    if (state.snapshot.activePath === path) this.emit(sessionId, { content });
  }

  emit(sessionId, patch) {
    const state = this.session(sessionId);
    state.snapshot = { ...state.snapshot, ...patch };
    for (const listener of state.listeners) listener();
  }
}
