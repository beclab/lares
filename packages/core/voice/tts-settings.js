import { ttsVoiceForModel, fetchTtsVoices } from "./tts-voice.js";
import { voiceActivity } from "./activity.js";

export const TTS_PREVIEW_TEXT = "你好，这是 Lares 的语音试听。";

export function ttsSettingsModel(value) {
  const config = value?.config || {};
  const ids = value?.ttsModels || [];
  return config.ttsModel ? ids.includes(config.ttsModel) ? config.ttsModel : null : value?.ttsDefault || ids[0] || null;
}

/** Framework-neutral settings lifecycle; model switches invalidate both audio and directory results. */
export function createTtsSettings({ preferences, list = fetchTtsVoices, preview, activity = voiceActivity }) {
  const initialModel = ttsSettingsModel(preferences.getSnapshot().value);
  let state = { model: initialModel, voices: [], selected: ttsVoiceForModel(preferences.getSnapshot().value?.config || {}, initialModel) || "", loading: Boolean(initialModel), error: null, saving: false, playing: false, previewError: null, blocked: activity.getSnapshot(), unavailable: false };
  const listeners = new Set();
  let generation = 0, listing = null, playing = null, disposed = false;
  const emit = patch => { if (disposed) return; state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const stop = () => { playing?.abort(); playing = null; emit({ playing: false }); };
  const selection = () => ttsVoiceForModel(preferences.getSnapshot().value?.config || {}, state.model) || "";
  const updateSelection = () => {
    const selected = selection();
    emit({ selected, unavailable: Boolean(selected && !state.loading && !state.error && !state.voices.some(row => row.id === selected)) });
  };
  const load = async () => {
    const token = ++generation; listing?.abort(); stop();
    const model = ttsSettingsModel(preferences.getSnapshot().value);
    emit({ model, voices: [], loading: Boolean(model), error: null, unavailable: false, previewError: null });
    updateSelection();
    if (!model) return;
    const abort = listing = new AbortController();
    try {
      const voices = await list(model, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]) });
      if (token !== generation || disposed) return;
      emit({ voices, loading: false }); updateSelection();
    } catch (error) {
      if (token === generation && !disposed && !abort.signal.aborted) emit({ loading: false, error: "tts_voices_failed" });
    }
  };
  let wasLoading = preferences.getSnapshot().loading, catalog = JSON.stringify(preferences.getSnapshot().value?.ttsModels || []);
  const off = preferences.subscribe(() => {
    const view = preferences.getSnapshot(), refreshed = wasLoading && !view.loading;
    wasLoading = view.loading;
    const nextCatalog = JSON.stringify(view.value?.ttsModels || []), changed = catalog !== nextCatalog; catalog = nextCatalog;
    const model = ttsSettingsModel(preferences.getSnapshot().value);
    if (model !== state.model || model && (refreshed || changed)) { void load(); return; }
    if (selection() !== state.selected) { stop(); updateSelection(); }
  });
  const offActivity = activity.subscribe(() => { const blocked = activity.getSnapshot(); if (blocked) stop(); emit({ blocked }); });
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    load,
    stop,
    async selectModel(model) {
      if (state.saving) return;
      stop(); emit({ saving: true, previewError: null });
      try { await preferences.patch({ ttsModel: model }); }
      finally { emit({ saving: false }); }
    },
    async selectVoice(voice) {
      if (state.loading || state.error || state.saving || !state.model || voice && !state.voices.some(row => row.id === voice)) return;
      const model = state.model; stop(); emit({ saving: true, previewError: null });
      try { await preferences.saveTtsVoice(model, voice); updateSelection(); }
      finally { emit({ saving: false }); }
    },
    async audition() {
      if (state.playing) { stop(); return; }
      if (!state.model || state.loading || state.error || state.saving || state.unavailable || state.blocked) return;
      const abort = playing = new AbortController();
      const take = { model: state.model, voice: state.selected || undefined, text: TTS_PREVIEW_TEXT, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]) };
      emit({ playing: true, previewError: null });
      try { await preview(take); }
      catch { if (playing === abort && !abort.signal.aborted) emit({ previewError: "tts_preview_failed" }); }
      finally { if (playing === abort) { playing = null; emit({ playing: false }); } }
    },
    dispose() { generation++; listing?.abort(); stop(); off(); offActivity(); disposed = true; listeners.clear(); },
  };
}
