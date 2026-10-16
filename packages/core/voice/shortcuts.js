const ACTIONS = ["default", "raw", "clean", "outline", "summary"];
const RESERVED = new Set(["Ctrl+w", "Meta+w", "Ctrl+t", "Meta+t", "Ctrl+r", "Meta+r", "Ctrl+l", "Meta+l", "Ctrl+n", "Meta+n", "Alt+F4", "Meta+q", "Ctrl+c", "Meta+c", "Ctrl+v", "Meta+v", "Ctrl+x", "Meta+x", "Ctrl+a", "Meta+a", "Ctrl+z", "Meta+z", "Ctrl+s", "Meta+s", "Ctrl+p", "Meta+p", "Ctrl+f", "Meta+f"]);
export function shortcutFromEvent(event) {
  const key = /^(Key[A-Z]|Digit[0-9])$/.test(event.code || "") ? event.code.replace(/^Key|^Digit/, "").toLowerCase() : event.key?.length === 1 ? event.key.toLowerCase() : event.key;
  if (!key || ["Control", "Meta", "Alt", "Shift"].includes(key)) return "";
  return [event.ctrlKey && "Ctrl", event.metaKey && "Meta", event.altKey && "Alt", event.shiftKey && "Shift", key].filter(Boolean).join("+");
}
export function validateVoiceShortcuts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== [...ACTIONS].sort().join()) throw new Error("voice_shortcut_invalid");
  const seen = new Set(); const result = {};
  for (const action of ACTIONS) {
    const key = value[action];
    if (typeof key !== "string" || (key && ((!/^(?:Ctrl\+)?(?:Meta\+)?(?:Alt\+)?(?:Shift\+)?(?:[a-z0-9]|F(?:[1-9]|1[0-2]))$/.test(key) || !/^(Ctrl|Meta|Alt)\+/.test(key)) || RESERVED.has(key) || seen.has(key)))) throw new Error("voice_shortcut_invalid");
    if (key) seen.add(key);
    result[action] = key;
  }
  return result;
}
export function matchVoiceShortcut(event, shortcuts) {
  if (event.repeat || event.isComposing || event.defaultPrevented) return null;
  const key = shortcutFromEvent(event);
  return key ? ACTIONS.find((action) => shortcuts?.[action] === key) || null : null;
}
