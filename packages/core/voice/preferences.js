import { DICTATION_INSTRUCTIONS, DICTATION_PRESETS } from "./dictation.js";
import { validateVoiceShortcuts } from "./shortcuts.js";

/** Editing drafts are independent of confirmed recording configuration. Writes merge at execution time. */
export function createVoicePreferences({ load, save }) {
  let state = { value: null, drafts: {}, pending: {}, errors: {}, loading: false, loadError: null };
  let serial = Promise.resolve(), loading = null;
  const listeners = new Set();
  const emit = patch => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const dirty = id => Boolean(state.drafts[id] && JSON.stringify(state.drafts[id]) !== JSON.stringify(state.value?.config.dictationProfiles[id]));
  const write = (key, build, accept = () => {}) => {
    if (state.pending[key]) return state.pending[key];
    const run = serial.catch(() => {}).then(async () => {
      try { const next = await save(build(state.value.config)); emit({ value: next }); accept(next.config); return next; }
      catch (error) { emit({ errors: { ...state.errors, [key]: error.reason || error.code || error.message } }); throw error; }
      finally { const pending = { ...state.pending }; delete pending[key]; emit({ pending }); }
    });
    serial = run; emit({ pending: { ...state.pending, [key]: run }, errors: { ...state.errors, [key]: null } });
    return run;
  };
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dirty,
    accept(value) { emit({ value }); },
    dirtyIds: () => Object.keys(state.drafts).filter(dirty),
    profile: id => state.drafts[id] || state.value?.config.dictationProfiles[id],
    async load(force = false) {
      if (loading) return loading;
      emit({ loading: true, loadError: null });
      loading = load({ force, diagnostics: false }).then(value => { emit({ value }); return value; }, error => { emit({ loadError: error.code || error.message }); throw error; }).finally(() => { loading = null; emit({ loading: false }); });
      return loading;
    },
    patch: partial => write(Object.keys(partial)[0], () => partial),
    edit(id, partial) { emit({ drafts: { ...state.drafts, [id]: { ...(state.drafts[id] || state.value.config.dictationProfiles[id]), ...partial } }, errors: { ...state.errors, [`profile:${id}`]: null } }); },
    restore(id) { this.edit(id, { instructions: DICTATION_INSTRUCTIONS[id] }); },
    discard(ids = this.dirtyIds()) { const drafts = { ...state.drafts }, errors = { ...state.errors }; for (const id of ids) { delete drafts[id]; delete errors[`profile:${id}`]; } emit({ drafts, errors }); },
    saveProfile(id) {
      const take = structuredClone(this.profile(id));
      return write(`profile:${id}`, config => ({ dictationProfiles: { ...config.dictationProfiles, [id]: take } }), () => {
        if (JSON.stringify(state.drafts[id]) === JSON.stringify(take)) this.discard([id]);
      });
    },
    async saveDirty() { for (const id of this.dirtyIds()) await this.saveProfile(id); },
    saveShortcut(id, key) { return write(`shortcut:${id}`, config => ({ dictationShortcuts: validateVoiceShortcuts({ ...config.dictationShortcuts, [id]: key }) })); },
  };
}

/** Shared three-way unsaved-edit guard; platforms only render its question. */
export function createPreferencesGuard(preferences) {
  let state = { open: false, saving: false, selecting: false, error: false }, pending = null, selection = null;
  const listeners = new Set();
  const emit = patch => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const finish = value => { pending?.resolve(value); pending = null; emit({ open: false, saving: false }); };
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    request() {
      if (pending) return pending.promise;
      if (!preferences.dirtyIds().length) return Promise.resolve(true);
      let resolve; const promise = new Promise(done => { resolve = done; }); pending = { promise, resolve };
      emit({ open: true, error: false }); return promise;
    },
    selectPreset(id) {
      if (!DICTATION_PRESETS.includes(id)) return Promise.reject(new Error("voice_config_invalid"));
      if (selection) return selection;
      if (id === preferences.getSnapshot().value.config.dictationPreset) return Promise.resolve(true);
      emit({ selecting: true });
      selection = (async () => {
        try {
          if (!await this.request()) return false;
          await preferences.patch({ dictationPreset: id });
          return true;
        } finally { selection = null; emit({ selecting: false }); }
      })();
      return selection;
    },
    async answer(action) {
      if (state.saving) return;
      if (action === "continue") { finish(false); return; }
      if (action === "discard") { preferences.discard(); finish(true); return; }
      if (action !== "save") return;
      emit({ saving: true, error: false });
      try { await preferences.saveDirty(); finish(true); } catch { emit({ saving: false, error: true }); }
    },
    dispose() { finish(false); listeners.clear(); },
  };
}
