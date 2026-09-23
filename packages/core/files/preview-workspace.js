import { filesPathAfterPrefix, isFilesPath, parseFilesPath } from "../drive/files-path.js";
import { closeTab, openTab, touchTab } from "./preview-tabs.js";

export class NullScrollport {
  offset() {
    return null;
  }

  scrollTo() {}
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

const PREVIEW_KINDS = new Set([
  "image", "video", "audio", "model3d", "pdf", "markdown", "text", "unsupported",
]);

export function isPreviewPayload(payload) {
  return Boolean(
    payload
    && typeof payload === "object"
    && typeof payload.path === "string"
    && payload.path !== ""
    && typeof payload.name === "string"
    && PREVIEW_KINDS.has(payload.kind)
    && Number.isSafeInteger(payload.size)
    && payload.size >= 0
    && (payload.modifiedAt === undefined || Number.isFinite(payload.modifiedAt))
    && (!["text", "markdown"].includes(payload.kind) || typeof payload.text === "string"),
  );
}

/**
 * The path the preview should ask the Host for. dsh already joined a relative
 * target onto the session cwd; a Files address must go back to its own
 * namespace before it becomes a tab key or a query.
 */
export function previewOpenPath(cwd, path) {
  const requested = String(path ?? "");
  if (isFilesPath(requested)) return parseFilesPath(requested);
  return filesPathAfterPrefix(cwd, requested) ?? requested;
}

export async function fetchPreview(sessionId, path, options = {}) {
  const query = new URLSearchParams({ sessionId, path });
  const response = await fetch(`/api/lares/file-preview/preview?${query}`, {
    signal: options.signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorCode(payload));
  if (!isPreviewPayload(payload)) throw new Error("file_preview_failed");
  return payload;
}

export async function fetchPreviewMap(sessionId, paths, options = {}) {
  const entries = await Promise.all(paths.map(async (path) => {
    try {
      return [path, await fetchPreview(sessionId, path, options)];
    } catch {
      return [path, null];
    }
  }));
  return new Map(entries);
}

export function isPrimaryUnmodifiedClick(event) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function workspaceLinkClickPath(sessionId, event) {
  if (!isPrimaryUnmodifiedClick(event)) return null;
  const anchor = event.target?.closest?.("a[href]");
  if (!anchor) return null;
  return rawUrlPath(sessionId, anchor.getAttribute("href"));
}

/**
 * The agent Reads the application overlay (`/app/packages/…`). That is source,
 * not a user file: the preview cannot serve it, and treating the path as an
 * openable chip only produces a dead tab. `/app/name.ext` still probes because
 * the workspace aliases that basename.
 */
export function isUnpreviewableOpenPath(path) {
  const text = String(path ?? "").trim().replace(/\\/g, "/");
  if (!text.startsWith("/app")) return false;
  if (text === "/app" || text === "/app/") return true;
  const rest = text.slice("/app/".length);
  return rest.includes("/");
}

const FILE_ADDRESS_PREFIX = "dsh-resource://file/session/";

/**
 * The session and path behind dsh's session file address
 * (`dsh-resource://file/session/<id>/<path>`), or null for any other resource.
 * Query and fragment suffixes are dsh's navigation parameters, not the path.
 * An empty path names the session's workspace root — a directory the preview
 * never serves — so it reads as no file address at all.
 */
export function parseSessionFileAddress(address) {
  const text = String(address ?? "");
  if (!text.startsWith(FILE_ADDRESS_PREFIX)) return null;
  const end = text.search(/[?#]/);
  const body = text.slice(FILE_ADDRESS_PREFIX.length, end === -1 ? undefined : end);
  const [id, ...segments] = body.split("/");
  if (!id || segments.length === 0) return null;
  let decoded;
  try {
    decoded = { sessionId: decodeURIComponent(id), path: segments.map(decodeURIComponent).join("/") };
  } catch {
    return null;
  }
  return decoded.path === "" ? null : decoded;
}

/**
 * @param target - the session and path a Host open request decoded to.
 * @param openNative - the Host's own opener for a request the preview declines.
 */
export async function interceptOpenPath(workspace, target, openNative) {
  if (target.sessionId !== workspace.boundSession()) return openNative();
  if (isUnpreviewableOpenPath(target.path)) return;
  if (await workspace.openCurrent(target.path)) return;
  await openNative();
}

const RAW_ROUTE = "/api/lares/file-preview/raw";
const DOWNLOAD_ROUTE = "/api/lares/file-preview/download";

export function previewMetaUrl(sessionId, path) {
  const query = new URLSearchParams({ sessionId, path });
  return `/api/lares/file-preview/preview?${query}`;
}

/**
 * @param size - ask the files backend for a rendition of this size instead of
 * the stored bytes. Honored for images on the files backend and ignored
 * everywhere else, so a caller that wants a small copy may always ask.
 */
export function rawFileUrl(sessionId, path, modifiedAt, size) {
  const query = new URLSearchParams({ sessionId, path });
  if (modifiedAt !== undefined) query.set("v", String(modifiedAt));
  if (size) query.set("size", size);
  return `${RAW_ROUTE}?${query}`;
}

export function downloadFileUrl(sessionId, path) {
  const query = new URLSearchParams({ sessionId, path });
  return `${DOWNLOAD_ROUTE}?${query}`;
}

function pageOrigin() {
  return globalThis.location?.origin ?? "http://localhost";
}

/** Absolute form: markdown targets survive the renderer only as full URLs. */
export function rawFileHref(sessionId, path) {
  return new URL(rawFileUrl(sessionId, path), pageOrigin()).href;
}

/**
 * The workspace path behind a raw URL this session owns, or null for anything
 * else — the seam that turns a rewritten markdown target back into a preview.
 * The pathname may carry a host-proxy prefix (LarePass `/laresHost`).
 */
function isRawFilePathname(pathname) {
  return pathname === RAW_ROUTE || pathname.endsWith(RAW_ROUTE);
}

export function rawUrlPath(sessionId, href) {
  let url;
  try {
    url = new URL(href, pageOrigin());
  } catch {
    return null;
  }
  if (url.origin !== pageOrigin() || !isRawFilePathname(url.pathname)) return null;
  if (url.searchParams.get("sessionId") !== sessionId) return null;
  return url.searchParams.get("path");
}

export class FilePreviewWorkspace {
  constructor(scrollport = new NullScrollport()) {
    this.sessions = new Map();
    this.current = null;
    this.scrollport = scrollport;
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
      chatOffset: null,
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

  bindCurrent(sessionId, cwd) {
    const binding = { sessionId, cwd, openVersion: 0 };
    this.current = binding;
    return () => {
      if (this.current === binding) this.current = null;
    };
  }

  /** The session the on-screen conversation mounted, or null while none is. */
  boundSession() {
    return this.current?.sessionId ?? null;
  }

  /**
   * Claim a Host open request, or decline it. The preview serves regular files
   * only, so the target is resolved before any tab exists: a directory stays
   * with the Host's own opener instead of becoming a tab that can never load.
   * Overlay source is declined without a fetch or a tab — claiming it is what
   * turned Read rows like `/app/packages/…` into a clickable preview that then
   * failed. Files errors (auth included) still open a tab so the chat view's
   * successful claim is not a silent click; Host does not native-open.
   */
  async openCurrent(path) {
    if (!this.current) return false;
    const binding = this.current;
    const { sessionId, cwd } = binding;
    const version = ++binding.openVersion;
    const target = previewOpenPath(cwd, path);
    if (isUnpreviewableOpenPath(target)) return false;
    const content = await this.fetchContent(sessionId, target);
    // A later click or session switch owns the surface. The old request was
    // still claimed, but must not steal focus or open a stale native panel.
    if (this.current !== binding || binding.openVersion !== version) return true;
    if (content.status === "error" && content.message === "path_not_file") return false;
    this.open(sessionId, target, content);
    return true;
  }

  showChat(sessionId) {
    this.emit(sessionId, { mode: "chat", evictedName: null });
  }

  /** @param resolved - content the caller already fetched; absent loads it here. */
  open(sessionId, path, resolved) {
    if (resolved?.status === "ready" && resolved.data?.path) path = resolved.data.path;
    const state = this.session(sessionId);
    const { tabs, lru, evicted } = openTab({ tabs: state.snapshot.tabs, lru: state.lru }, path);
    state.lru = lru;
    if (evicted) {
      state.contents.delete(evicted.path);
      state.offsets.delete(evicted.path);
      state.requestVersions.delete(evicted.path);
    }
    if (resolved !== undefined) {
      state.contents.set(path, resolved);
      state.requestVersions.set(path, (state.requestVersions.get(path) ?? 0) + 1);
    }
    this.emit(sessionId, {
      mode: "preview",
      tabs,
      activePath: path,
      content: state.contents.get(path) ?? { status: "idle" },
      evictedName: evicted?.name ?? null,
    });
    if (resolved === undefined) void this.load(sessionId, path, true);
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
    void this.load(sessionId, path, true);
  }

  close(sessionId, path) {
    const state = this.session(sessionId);
    const closed = closeTab(
      { tabs: state.snapshot.tabs, lru: state.lru, activePath: state.snapshot.activePath },
      path,
    );
    if (!closed) return;
    const { tabs, activePath } = closed;
    state.lru = closed.lru;
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
    if (activePath === state.snapshot.activePath) {
      this.emit(sessionId, { tabs, evictedName: null });
      return;
    }
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
    state.lru = touchTab(state.lru, path);
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

  async load(sessionId, path, force = false) {
    const state = this.session(sessionId);
    const current = state.contents.get(path);
    if (!force && (current?.status === "ready" || current?.status === "loading")) return;
    const version = (state.requestVersions.get(path) ?? 0) + 1;
    state.requestVersions.set(path, version);
    if (current?.status !== "ready") {
      state.contents.set(path, { status: "loading" });
      if (state.snapshot.activePath === path) this.emit(sessionId, { content: { status: "loading" } });
    }
    const content = await this.fetchContent(sessionId, path);
    if (state.requestVersions.get(path) !== version) return;
    state.contents.set(path, content);
    if (state.snapshot.activePath === path) this.emit(sessionId, { content });
  }

  /**
   * Hand the chat scrollport back where the reader left it. Called once the
   * overlay is off screen — earlier the flow is still collapsed and the write
   * would be clamped away again.
   */
  restoreChatScroll(sessionId) {
    const state = this.session(sessionId);
    if (state.chatOffset === null) return;
    const offset = state.chatOffset;
    state.chatOffset = null;
    this.scrollport.scrollTo(offset);
  }

  /**
   * Drop a captured offset without writing it. Switching sessions unmounts the
   * previous conversation: its scroller is gone, and writing into the new one
   * would jump a different thread.
   */
  abandonChatScroll(sessionId) {
    this.session(sessionId).chatOffset = null;
  }

  emit(sessionId, patch) {
    const state = this.session(sessionId);
    const next = { ...state.snapshot, ...patch };
    // Mode transitions run ahead of the commit that mounts the overlay, so this
    // is the last moment the reader's own offset is still readable.
    if (state.snapshot.mode === "chat" && next.mode === "preview") {
      state.chatOffset = this.scrollport.offset();
    }
    state.snapshot = next;
    for (const listener of state.listeners) listener();
  }
}
