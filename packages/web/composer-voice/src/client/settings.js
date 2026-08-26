import React from "react";
import {
  controlsCss,
  SettingsHeader,
  SettingsSelector,
  SettingsStatus,
} from "../../../shared/client/settings-controls.js";
import { useLatest, useMountedRef } from "../../../shared/client/react-lifecycle.js";
import { loadVoiceSettings, rememberedVoiceSettings, saveVoiceSettings } from "./api.js";
import {
  EMPTY_VOICE_CONFIG,
  voiceLanguageItems,
  voiceMenuValue,
  voiceModelItems,
  voiceStatusReady,
  voiceValueFromMenu,
} from "@lares/core/voice/languages";
import { MicGlyph } from "./icons.js";
import { useT } from "./locale.js";
import localSettingsCss from "./styles/settings.css";

const { useCallback, useEffect, useState } = React;
const h = React.createElement;

export const settingsCss = `${controlsCss}${localSettingsCss}`;

function Row(title, hint, control) {
  return h(
    "div",
    { className: "lares-voice-row" },
    h(
      "div",
      { className: "lares-voice-row-text" },
      h("div", { className: "lares-voice-row-title" }, title),
      hint ? h("div", { className: "lares-voice-hint" }, hint) : null,
    ),
    control,
  );
}

export function VoiceSettings() {
  const t = useT();
  const [view, setView] = useState(rememberedVoiceSettings);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState(null);
  const mounted = useMountedRef();
  const translate = useLatest(t);

  useEffect(() => {
    let alive = true;
    loadVoiceSettings()
      .then((next) => {
        if (alive) setView(next);
      })
      .catch(() => {
        if (alive && mounted.current) {
          setView((current) => current ?? {
            config: EMPTY_VOICE_CONFIG,
            status: { modelAvailable: false },
            sttModels: [],
          });
          setNotice({ kind: "error", text: translate.current("settings.loadFailed") });
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setNotice(null);
    try {
      const next = await loadVoiceSettings({ force: true });
      if (mounted.current) setView(next);
    } catch {
      if (mounted.current) setNotice({ kind: "error", text: translate.current("settings.refreshFailed") });
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, []);

  const patch = useCallback(async (key, value) => {
    if (!view) return;
    const previous = view;
    setView({ ...view, config: { ...view.config, [key]: value } });
    setSaving(true);
    setNotice(null);
    try {
      const next = await saveVoiceSettings({ [key]: value });
      if (mounted.current) setView(next);
    } catch {
      if (mounted.current) {
        setView(previous);
        setNotice({ kind: "error", text: translate.current("settings.saveFailed") });
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, [view]);

  if (!view) {
    return h(
      "div",
      { className: "lares-voice" },
      h("div", { className: "lares-settings-notice" }, t("settings.loading")),
    );
  }

  const { config, status, sttModels } = view;
  const modelItems = voiceModelItems(sttModels, t("settings.model.auto"));
  const ready = voiceStatusReady(status);

  return h(
    "div",
    { className: "lares-voice" },
    h(SettingsHeader, {
      title: t("settings.title"),
      refreshing,
      disabled: refreshing || saving,
      onRefresh: refresh,
      routerRoute: "audio",
      t,
    }),
    h("p", { className: "lares-settings-intro" }, t("settings.intro")),
    h(
      SettingsStatus,
      { ready },
      ready
        ? t("settings.status.ready", { model: status?.model || t("status.auto") })
        : t("settings.status.notReady"),
    ),

    h(
      "div",
      { className: "lares-voice-rows" },
      Row(
        t("settings.model.title"),
        t("settings.model.hint"),
        h(SettingsSelector, {
          value: voiceMenuValue(config.model),
          items: modelItems,
          disabled: saving || refreshing,
          onSelect: (id) => patch("model", voiceValueFromMenu(id)),
        }),
      ),
      Row(
        t("settings.language.title"),
        t("settings.language.hint"),
        h(SettingsSelector, {
          value: voiceMenuValue(config.language),
          items: voiceLanguageItems(t("lang.auto")),
          disabled: saving || refreshing,
          onSelect: (id) => patch("language", voiceValueFromMenu(id)),
        }),
      ),
    ),

    notice
      ? h("p", { className: `lares-settings-notice ${notice.kind === "error" ? "is-error" : ""}` }, notice.text)
      : null,
  );
}

/** Settings nav glyph, read off the component by the shell's row projection. */
VoiceSettings.navIcon = MicGlyph;
