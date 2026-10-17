import React from "react";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import { createVoiceShortcutRecorder, formatVoiceShortcut } from "@olares/lares-core/voice/shortcuts";
import { DICTATION_PRESETS } from "@olares/lares-core/voice/dictation";
const h = React.createElement;

export function ShortcutSettings({ preferences, t }) {
  const [recorder] = React.useState(() => createVoiceShortcutRecorder({ current: () => preferences.getSnapshot().value.config.dictationShortcuts, save: (id, key) => preferences.saveShortcut(id, key) }));
  const view = React.useSyncExternalStore(recorder.subscribe, recorder.getSnapshot);
  const bindings = React.useRef({}), previous = React.useRef({});
  React.useEffect(() => {
    if (!view.action && document.activeElement === document.body) {
      const restored = Object.keys(previous.current).find(id => previous.current[id] && !view.pending[id]);
      if (restored) bindings.current[restored]?.focus();
    }
    previous.current = view.pending;
  }, [view.pending, view.action]);
  const config = preferences.getSnapshot().value.config;
  const mac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || "");
  const key = (event, up) => { if ((up ? recorder.keyup(event) : recorder.keydown(event))) { event.preventDefault(); event.stopPropagation(); } };
  return h("section", { className: "lares-voice-group" },
    h("h3", { className: "lares-preset-heading" }, t("preferences.shortcuts")),
    h("p", { className: "lares-voice-hint" }, t("preferences.shortcutScope")),
    ...["default", ...DICTATION_PRESETS].map(id => {
      const title = t(id === "default" ? "dictation.shortcut" : `dictation.${id}`), active = view.action === id;
      return h("div", { className: "lares-shortcut-item", key: id, "data-voice-shortcut-recorder": "", onKeyDownCapture: event => key(event, false), onKeyUpCapture: event => key(event, true),
        onBlur: event => { if (!event.currentTarget.contains(event.relatedTarget) && active) recorder.cancel(); } },
        h("div", { className: "lares-voice-row" }, h("span", { className: "lares-voice-row-title" }, title),
          h("div", { className: "lares-voice-controls" },
            h(Button, { ref: element => { bindings.current[id] = element; }, variant: "outline", size: "sm", disabled: view.pending[id], "aria-label": `${title}: ${active ? t("preferences.shortcutRecording") : formatVoiceShortcut(config.dictationShortcuts[id], mac) || t("preferences.unset")}`,
              className: active ? "lares-shortcut-binding is-recording" : "lares-shortcut-binding", onClick: () => recorder.begin(id) },
            active ? view.candidate ? formatVoiceShortcut(view.candidate, mac) : t("preferences.shortcutRecording") : view.pending[id] ? t("preferences.saving") : formatVoiceShortcut(config.dictationShortcuts[id], mac) || t("preferences.unset")),
            config.dictationShortcuts[id] ? h(Button, { variant: "ghost", size: "sm", disabled: view.pending[id], "aria-label": `${t("preferences.clear")} ${title}`, onClick: () => { void recorder.clear(id); } }, "×") : null)),
        active ? h("p", { role: "status", className: "lares-voice-hint" }, t("preferences.shortcutHelp")) : null,
        view.errors[id] ? h("p", { role: "alert", className: "lares-settings-notice is-error" }, t(`preferences.shortcutError.${view.errors[id]}`),
          view.failed[id] != null ? h(Button, { variant: "ghost", size: "sm", disabled: view.pending[id], onClick: () => { void recorder.retry(id); } }, t("dictation.retry")) : null) : null);
    }));
}
