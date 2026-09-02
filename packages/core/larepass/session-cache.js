import { mergeEvents } from "./transcript.js";

function emptyPage() {
  return {
    events: [],
    scroll: { top: 0, stick: true },
    ready: false,
  };
}

function eventStamp(event) {
  return `${event.seq}\0${event.type}\0${JSON.stringify(event.data)}\0${JSON.stringify(event.view ?? null)}`;
}

export function eventsUpdated(prev, next) {
  if (prev === next) return false;
  if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length) return true;
  for (let i = 0; i < next.length; i += 1) {
    if (prev[i] === next[i]) continue;
    if (eventStamp(prev[i]) !== eventStamp(next[i])) return true;
  }
  return false;
}

export function createSessionCache() {
  const pages = new Map();
  const loads = new Map();

  function peek(sessionId) {
    return sessionId ? pages.get(sessionId) ?? null : null;
  }

  function ensure(sessionId) {
    let page = peek(sessionId);
    if (page) return page;
    page = emptyPage();
    pages.set(sessionId, page);
    return page;
  }

  function commit(sessionId, extra, ready) {
    if (!sessionId) return false;
    const page = ensure(sessionId);
    const next = extra?.length ? mergeEvents(page.events, extra) : page.events;
    const changed = eventsUpdated(page.events, next);
    if (changed) page.events = next;
    let flipped = false;
    if (ready && !page.ready) {
      page.ready = true;
      flipped = true;
    }
    return changed || flipped;
  }

  return {
    peek,
    events(sessionId) {
      return peek(sessionId)?.events ?? [];
    },
    scroll(sessionId) {
      return peek(sessionId)?.scroll ?? { top: 0, stick: true };
    },
    ready(sessionId) {
      return Boolean(peek(sessionId)?.ready);
    },
    loading(sessionId) {
      return Boolean(sessionId) && loads.has(sessionId);
    },
    merge(sessionId, extra) {
      return commit(sessionId, extra, false);
    },
    rememberHistory(sessionId, extra) {
      return commit(sessionId, extra, true);
    },
    readyEmpty(sessionId) {
      if (!sessionId) return;
      const page = ensure(sessionId);
      if (page.events.length === 0) page.ready = true;
    },
    drop(sessionId) {
      if (!sessionId) return;
      pages.delete(sessionId);
      loads.delete(sessionId);
    },
    setScroll(sessionId, scroll) {
      if (!sessionId || !scroll) return;
      ensure(sessionId).scroll = scroll;
    },
    load(sessionId, start) {
      if (!sessionId) return Promise.resolve();
      const pending = loads.get(sessionId);
      if (pending) return pending;
      const job = Promise.resolve().then(start).finally(() => {
        if (loads.get(sessionId) === job) loads.delete(sessionId);
      });
      loads.set(sessionId, job);
      return job;
    },
    clear() {
      pages.clear();
      loads.clear();
    },
  };
}
