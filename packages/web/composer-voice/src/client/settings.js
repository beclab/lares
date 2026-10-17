import React from "react";
import { Switch } from "@deepseek-ai/dsh-client-ui-primitives";
import { DICTATION_PRESETS } from "@olares/lares-core/voice/dictation";
import { createVoicePreferences } from "@olares/lares-core/voice/preferences";
import { VOICE_PRESETS } from "@olares/lares-core/voice/options";
import { voiceLanguageItems, voiceMenuValue, voiceValueFromMenu } from "@olares/lares-core/voice/languages";
import { controlsCss, SettingsHeader, SettingsSelector } from "../../../shared/client/settings-controls.js";
import { watchCatalogRevision } from "../../../shared/client/catalog-events.js";
import { loadVoiceSettings, saveVoiceSettings } from "./api.js";
import { PresetEditor } from "./preset-editor.js";
import { ShortcutSettings } from "./shortcut-settings.js";
import { usePreferencesLeave } from "./preferences-leave.js";
import { BluetoothDevices } from "./bluetooth.js";
import { MicGlyph } from "./icons.js";
import { useT } from "./locale.js";
import localSettingsCss from "./styles/settings.css";

const h = React.createElement;
export const settingsCss = `${controlsCss}${localSettingsCss}`;
function Group(title, ...rows) {
  return h("section", { className: "lares-voice-group" }, h("div", { className: "lares-voice-group-title" }, title), h("div", { className: "lares-voice-card" }, ...rows));
}
function Row(title, control, hint) {
  return h("div", { className: "lares-voice-row" }, h("div", { className: "lares-voice-row-text" },
    h("div", { className: "lares-voice-row-title" }, title), hint ? h("div", { className: "lares-voice-hint" }, hint) : null), control);
}

export function VoiceSettings({ bindBeforeLeave } = {}) {
  const t = useT();
  const [preferences] = React.useState(() => createVoicePreferences({ load: loadVoiceSettings, save: saveVoiceSettings }));
  const view = React.useSyncExternalStore(preferences.subscribe, preferences.getSnapshot);
  const leave = usePreferencesLeave(preferences, bindBeforeLeave, t);
  React.useEffect(() => {
    void preferences.load().catch(() => {});
    return watchCatalogRevision(() => { void preferences.load(true).catch(() => {}); });
  }, [preferences]);
  const patch = partial => { void preferences.patch(partial).catch(() => {}); };
  const selector = (field, title, items, hint) => Row(title, h("div", { className: "lares-setting-field" },
    h(SettingsSelector, { value: view.value.config[field] || (field === "model" || field === "ttsModel" ? "__auto__" : "default-chat"), items, disabled: Boolean(view.pending[field]), onSelect: value => patch({ [field]: value === "__auto__" ? "" : value }) }),
    view.errors[field] ? h("p", { role: "alert", className: "lares-settings-notice is-error" }, t("settings.saveFailed")) : null), hint);
  if (!view.value) return h("div", { className: "lares-voice" }, h(SettingsHeader, { title: t("settings.title"), refreshing: view.loading, disabled: view.loading, onRefresh: () => { void preferences.load(true).catch(() => {}); }, routerRoute: "audio", t }),
    h("p", { role: "status" }, t(view.loadError ? "settings.loadFailed" : "settings.loading")));
  const { config, sttModels = [], ttsModels = [], chatModels = [] } = view.value;
  const modelItems = (ids, selected, automatic = true) => [
    ...(automatic ? [{ id: "__auto__", label: t("settings.model.auto") }] : []),
    ...[...new Set([selected, ...ids].filter(Boolean))].map(id => ({ id, label: id })),
  ];
  const modelHint = ids => ids.length ? null : t("preferences.modelsMissing");
  const changeDefault = async dictationPreset => { if (dictationPreset !== config.dictationPreset && await leave.request()) await preferences.patch({ dictationPreset }).catch(() => {}); };
  return h("div", { className: "lares-voice" },
    h(SettingsHeader, { title: t("settings.title"), refreshing: view.loading, disabled: view.loading, onRefresh: () => { void preferences.load(true).catch(() => {}); }, routerRoute: "audio", t }),
    view.loadError ? h("p", { role: "alert", className: "lares-settings-notice is-error" }, t("settings.refreshFailed")) : null,
    Group(t("dictation.settings"),
      selector("model", t("settings.stt.model"), modelItems(sttModels, config.model), modelHint(sttModels)),
      Row(t("settings.language.title"), h(SettingsSelector, { value: voiceMenuValue(config.language), items: voiceLanguageItems(t("lang.auto")), disabled: Boolean(view.pending.language), onSelect: id => patch({ language: voiceValueFromMenu(id) }) }), t("settings.language.hint")),
      Row(t("preferences.defaultPreset"), h("div", { className: "lares-setting-field" }, h(SettingsSelector, { value: config.dictationPreset, items: DICTATION_PRESETS.map(id => ({ id, label: t(`dictation.${id}`) })), disabled: Boolean(view.pending.dictationPreset), onSelect: value => { void changeDefault(value); } }),
        view.errors.dictationPreset ? h("p", { role: "alert", className: "lares-settings-notice is-error" }, t("settings.saveFailed")) : null)),
      h(PresetEditor, { key: config.dictationPreset, id: config.dictationPreset, preferences, view, t }),
      h("details", { className: "lares-settings-disclosure" }, h("summary", null, t("preferences.otherPresets")),
        ...DICTATION_PRESETS.filter(id => id !== config.dictationPreset).map(id => h("details", { key: id, className: "lares-settings-disclosure" },
          h("summary", null, t(`dictation.${id}`), preferences.dirty(id) ? h("span", { className: "lares-voice-hint" }, ` · ${t("preferences.modified")}`) : null), h(PresetEditor, { id, preferences, view, t }))))),
    Group(t("settings.conversation"),
      selector("preset", t("settings.preset"), VOICE_PRESETS.map(id => ({ id, label: t(`settings.preset.${id}`) }))),
      selector("chatModel", t("settings.chatModel"), modelItems([...new Set(["default-chat", ...chatModels])], config.chatModel, false), modelHint(chatModels)),
      selector("backend", t("settings.backend"), [{ id: "pipeline", label: t("settings.backend.pipeline") }, ...((view.value.realtimeReady || []).includes(config.realtimeModel) ? [{ id: "realtime", label: "Realtime" }] : [])], t("settings.realtime.hint")),
      (view.value.realtimeModels || []).length ? selector("realtimeModel", t("settings.realtime.model"), modelItems(view.value.realtimeModels, config.realtimeModel, false)) : null,
      selector("mobileMode", t("settings.mobileMode"), ["single", "continuous"].map(id => ({ id, label: t(`settings.mode.${id}`) }))),
      selector("device", t("settings.device"), ["auto", "device", "headset"].map(id => ({ id, label: t(`settings.device.${id}`) }))),
      selector("ttsModel", t("settings.tts.model"), modelItems(ttsModels, config.ttsModel), modelHint(ttsModels)),
      Row(t("settings.speak.title"), h(Switch, { checked: config.speak === true, disabled: Boolean(view.pending.speak), label: t("settings.speak.label"), onChange: speak => patch({ speak }) }), t("settings.tts.hint")),
      ...["language", "speak"].filter(id => view.errors[id]).map(id => h("p", { key: id, role: "alert", className: "lares-settings-notice is-error" }, t("settings.saveFailed")))),
    h(ShortcutSettings, { preferences, t }),
    Group(t("settings.group.bluetooth"), h(BluetoothDevices, { t })),
    leave.modal);
}
VoiceSettings.navIcon = MicGlyph;
