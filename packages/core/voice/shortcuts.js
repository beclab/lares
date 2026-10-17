const ACTIONS = ["default", "raw", "clean", "outline", "summary"];
const RESERVED = new Set(["Ctrl+w", "Meta+w", "Ctrl+t", "Meta+t", "Ctrl+r", "Meta+r", "Ctrl+l", "Meta+l", "Ctrl+n", "Meta+n", "Alt+F4", "Meta+q", "Ctrl+c", "Meta+c", "Ctrl+v", "Meta+v", "Ctrl+x", "Meta+x", "Ctrl+a", "Meta+a", "Ctrl+z", "Meta+z", "Ctrl+s", "Meta+s", "Ctrl+p", "Meta+p", "Ctrl+f", "Meta+f"]);
export function shortcutFromEvent(event) {
  const key = /^(Key[A-Z]|Digit[0-9])$/.test(event.code || "") ? event.code.replace(/^Key|^Digit/, "").toLowerCase() : event.key?.length === 1 ? event.key.toLowerCase() : event.key;
  if (!key || ["Control", "Meta", "Alt", "Shift"].includes(key)) return "";
  return [event.ctrlKey && "Ctrl", event.metaKey && "Meta", event.altKey && "Alt", event.shiftKey && "Shift", key].filter(Boolean).join("+");
}
export function voiceShortcutProblem(key, action, value) {
  if (typeof key !== "string" || key && (!/^(?:Ctrl\+)?(?:Meta\+)?(?:Alt\+)?(?:Shift\+)?(?:[a-z0-9]|F(?:[1-9]|1[0-2]))$/.test(key) || !/^(Ctrl|Meta|Alt)\+/.test(key))) return "invalid";
  if (RESERVED.has(key)) return "reserved";
  if (key && ACTIONS.some(id => id !== action && value[id] === key)) return "duplicate";
  return null;
}
export function validateVoiceShortcuts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== [...ACTIONS].sort().join()) throw new Error("voice_shortcut_invalid");
  const result = {};
  for (const action of ACTIONS) {
    const reason = voiceShortcutProblem(value[action], action, value);
    if (reason) throw Object.assign(new Error("voice_shortcut_invalid"), { reason });
    result[action] = value[action];
  }
  return result;
}
export function formatVoiceShortcut(value, mac = false) {
  if (!value) return "";
  return value.split("+").map(key => mac ? ({ Meta: "⌘", Alt: "⌥", Ctrl: "⌃", Shift: "⇧" })[key] || key.toUpperCase() : key.length === 1 ? key.toUpperCase() : key).join(mac ? "" : "+");
}

/** One recorder per settings page; only release of the chosen main key can commit it. */
export function createVoiceShortcutRecorder({ current, save }) {
  let state = { action: null, candidate: "", errors: {}, pending: {}, failed: {} }, code = null;
  const listeners = new Set();
  const emit = patch => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const commit = async (action, key) => {
    if (state.pending[action]) return;
    emit({ action: null, candidate: "", pending: { ...state.pending, [action]: true }, errors: { ...state.errors, [action]: null } });
    try { await save(action, key); emit({ failed: { ...state.failed, [action]: null } }); }
    catch (error) { emit({ errors: { ...state.errors, [action]: error.reason || "save" }, failed: { ...state.failed, [action]: key } }); }
    finally { emit({ pending: { ...state.pending, [action]: false } }); }
  };
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    begin(action) { if (!state.pending[action]) { code = null; emit({ action, candidate: "", errors: { ...state.errors, [action]: null } }); } },
    cancel() { code = null; emit({ action: null, candidate: "" }); },
    keydown(event) {
      if (!state.action) return false;
      if (event.key === "Tab") { this.cancel(); return false; }
      if (event.key === "Escape") { this.cancel(); return true; }
      if (event.repeat || event.isComposing) return true;
      const key = shortcutFromEvent(event);
      if (!key) return true;
      const error = voiceShortcutProblem(key, state.action, current());
      code = error ? null : event.code || event.key;
      emit({ candidate: error ? "" : key, errors: { ...state.errors, [state.action]: error } });
      return true;
    },
    keyup(event) {
      if (!state.action) return false;
      if (event.isComposing || event.repeat) return true;
      if (code && (event.code || event.key) === code && state.candidate) { const action = state.action, key = state.candidate; code = null; void commit(action, key); }
      return true;
    },
    clear: action => commit(action, ""),
    retry: action => state.failed[action] != null ? commit(action, state.failed[action]) : Promise.resolve(),
  };
}
export function matchVoiceShortcut(event, shortcuts) {
  if (event.repeat || event.isComposing || event.defaultPrevented) return null;
  const key = shortcutFromEvent(event);
  return key ? ACTIONS.find((action) => shortcuts?.[action] === key) || null : null;
}
