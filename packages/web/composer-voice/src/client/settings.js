import React from "react";
import { TtsSettings } from "./tts-settings.js";
import { DICTATION_PRESETS } from "@olares/lares-core/voice/dictation";
import { createVoicePreferences } from "@olares/lares-core/voice/preferences";
import { voiceLanguageItems, voiceMenuValue, voiceValueFromMenu } from "@olares/lares-core/voice/languages";
import { controlsCss, SettingsHeader, SettingsSelector } from "../../../shared/client/settings-controls.js";
import { watchCatalogRevision } from "../../../shared/client/catalog-events.js";
import { loadVoiceSettings, saveVoiceSettings } from "./api.js";
import { PresetEditor } from "./preset-editor.js";
import { ShortcutSettings } from "./shortcut-settings.js";
import { usePreferencesLeave } from "./preferences-leave.js";
import { BluetoothDevices } from "./bluetooth.js";
import { VoiceKeys } from "./voice-keys.js";
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
  const { config, sttModels = [] } = view.value;
  const modelItems = (ids, selected, automatic = true) => [
    ...(automatic ? [{ id: "__auto__", label: t("settings.model.auto") }] : []),
    ...[...new Set([selected, ...ids].filter(Boolean))].map(id => ({ id, label: id })),
  ];
  const modelHint = ids => ids.length ? null : t("preferences.modelsMissing");
  return h("div", { className: "lares-voice" },
    h(SettingsHeader, { title: t("settings.title"), refreshing: view.loading, disabled: view.loading, onRefresh: () => { void preferences.load(true).catch(() => {}); }, routerRoute: "audio", t }),
    view.loadError ? h("p", { role: "alert", className: "lares-settings-notice is-error" }, t("settings.refreshFailed")) : null,
    Group(t("dictation.settings"),
      selector("model", t("settings.stt.model"), modelItems(sttModels, config.model), modelHint(sttModels)),
      Row(t("settings.language.title"), h(SettingsSelector, { value: voiceMenuValue(config.language), items: voiceLanguageItems(t("lang.auto")), disabled: Boolean(view.pending.language), onSelect: id => patch({ language: voiceValueFromMenu(id) }) }), t("settings.language.hint")),
      Row(t("preferences.dictationStyle"), h("div", { className: "lares-setting-field" },
        h(SettingsSelector, { value: config.dictationPreset, items: DICTATION_PRESETS.map(id => ({ id, label: t(`dictation.${id}`) })), disabled: leave.selecting || Boolean(view.pending.dictationPreset), onSelect: id => { void leave.selectPreset(id).catch(() => {}); } }),
        view.errors.dictationPreset ? h("p", { role: "alert", className: "lares-settings-notice is-error" }, t("settings.saveFailed")) : null)),
      h(PresetEditor, { key: config.dictationPreset, id: config.dictationPreset, preferences, view, t, disabled: leave.selecting })),
    Group(t("settings.conversation"),
      selector("mobileMode", t("settings.mobileMode"), ["single", "continuous"].map(id => ({ id, label: t(`settings.mode.${id}`) }))),
      selector("device", t("settings.device"), ["auto", "device", "headset"].map(id => ({ id, label: t(`settings.device.${id}`) }))),
      view.errors.language ? h("p", { role: "alert" }, t("settings.saveFailed")) : null),
    h(TtsSettings, { preferences, view, t }),
    h(ShortcutSettings, { preferences, t }),
    Group(t("settings.group.bluetooth"), h(BluetoothDevices, { t })),
    Group(t("settings.group.keys"), h(VoiceKeys, { t })),
    leave.modal);
}
VoiceSettings.navIcon = MicGlyph;
