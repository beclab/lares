import { loadVoiceSettings } from "@olares/lares-core/voice/client";
import { recordVoiceStartup } from "@olares/lares-core/voice/startup";

export function createVoiceSettingsState() {
  let snapshot = { value: null, error: null }, pending;
  const listeners = new Set();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    refresh({ force = false } = {}) {
      if (pending) return pending;
      const started = performance.now();
      pending = loadVoiceSettings({ force, diagnostics: false }).then(value => {
        recordVoiceStartup("capabilities", performance.now() - started);
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
