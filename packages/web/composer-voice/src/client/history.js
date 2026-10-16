import React from "react";
import { subscribeVoiceHistory } from "@olares/lares-core/voice/projection";
import { request } from "./panel.js";
const feeds = new Map();
function feed(sessionId) {
  if (feeds.has(sessionId)) return feeds.get(sessionId);
  let value = { records: [], error: null }; let stop;
  const listeners = new Set();
  const update = (next) => { value = next; for (const listener of listeners) listener(); };
  const source = { getSnapshot: () => value, subscribe(listener) {
    listeners.add(listener);
    if (!stop && sessionId) stop = subscribeVoiceHistory({ sessionId, request, onRecords: (records) => update({ records, error: null }), onError: (error) => update({ ...value, error: error.message }) });
    return () => { listeners.delete(listener); if (!listeners.size) { stop?.(); stop = null; feeds.delete(sessionId); } };
  } };
  feeds.set(sessionId, source); return source;
}
export function useVoiceHistory(sessionId) {
  const source = React.useMemo(() => feed(sessionId), [sessionId]);
  return React.useSyncExternalStore(source.subscribe, source.getSnapshot);
}
