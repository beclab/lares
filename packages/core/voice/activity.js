const active = new Set(), listeners = new Set();
export const voiceActivity = {
  getSnapshot: () => active.size > 0,
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
};
export function setVoiceActivity(source, busy) {
  const previous = active.size > 0;
  busy ? active.add(source) : active.delete(source);
  if (previous !== (active.size > 0)) for (const listener of listeners) listener();
}
