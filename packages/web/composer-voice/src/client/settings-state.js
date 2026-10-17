import { loadVoiceSettings } from "@olares/lares-core/voice/client";

export function createVoiceSettingsState() {
  let snapshot = { value: null, error: null }, pending;
  const listeners = new Set();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    refresh() {
      if (pending) return pending;
      pending = loadVoiceSettings({ force: true }).then(value => {
        snapshot = { value, error: null };
        return value;
      }, error => {
        snapshot = { ...snapshot, error: error.code || "voice_failed" };
        throw error;
      }).finally(() => { pending = null; for (const listener of listeners) listener(); });
      return pending;
    },
  };
}
