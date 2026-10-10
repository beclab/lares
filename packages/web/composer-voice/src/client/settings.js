import React from "react";
import { Button, Switch } from "@deepseek-ai/dsh-client-ui-primitives";
import {
  controlsCss,
  SettingsHeader,
  SettingsSelector,
  SettingsStatus,
} from "../../../shared/client/settings-controls.js";
import { watchCatalogRevision } from "../../../shared/client/catalog-events.js";
import { useLatest, useMountedRef } from "../../../shared/client/react-lifecycle.js";
import { installVoiceChart, loadVoiceSettings, rememberedVoiceSettings, saveVoiceSettings } from "./api.js";
import {
  EMPTY_VOICE_CONFIG,
  selectedVoice,
  voiceChoiceItems,
  voiceLanguageItems,
  voiceMenuValue,
  voiceStatusReady,
  voiceValueFromMenu,
} from "@olares/lares-core/voice/languages";
import { BluetoothDevices } from "./bluetooth.js";
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
  const [installing, setInstalling] = useState(null);
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
            ttsModels: [],
          });
          setNotice({ kind: "error", text: translate.current("settings.loadFailed") });
        }
      });
    const stop = watchCatalogRevision(() => {
      if (alive) void loadVoiceSettings({ force: true }).then((next) => {
        if (alive) setView(next);
      }).catch(() => {});
    });
    return () => {
      alive = false;
      stop();
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

  const patch = useCallback(async (partial) => {
    if (!view) return;
    const previous = view;
    setView({ ...view, config: { ...view.config, ...partial } });
    setSaving(true);
    setNotice(null);
    try {
      const next = await saveVoiceSettings(partial);
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

  const install = useCallback(async (kind) => {
    setInstalling(kind);
    setNotice(null);
    try {
      const next = await installVoiceChart(kind);
      if (mounted.current) {
        setView(next);
        setNotice({ kind: "info", text: translate.current("settings.installStarted") });
      }
    } catch {
      if (mounted.current) setNotice({ kind: "error", text: translate.current("settings.installFailed") });
    } finally {
      if (mounted.current) setInstalling(null);
    }
  }, []);

  const pinned = React.useRef("");
  useEffect(() => {
    if (!view || saving) return;
    const sttIds = view.sttModels ?? [];
    const ttsIds = view.ttsModels ?? [];
    const partial = {};
    const nextStt = selectedVoice(view.config.model, sttIds);
    const nextTts = selectedVoice(view.config.ttsModel, ttsIds);
    if (sttIds.length && view.config.model !== nextStt) partial.model = nextStt;
    if (ttsIds.length && view.config.ttsModel !== nextTts) partial.ttsModel = nextTts;
    const key = JSON.stringify(partial);
    if (key === "{}" || pinned.current === key) return;
    pinned.current = key;
    void patch(partial);
  }, [view, patch, saving]);

  if (!view) {
    return h(
      "div",
      { className: "lares-voice" },
      h("div", { className: "lares-settings-notice" }, t("settings.loading")),
    );
  }

  const { config, status, sttModels, ttsModels } = view;
  const stt = sttModels ?? [];
  const tts = ttsModels ?? [];
  const sttValue = selectedVoice(config.model, stt);
  const ttsValue = selectedVoice(config.ttsModel, tts);
  const ready = voiceStatusReady(status);
  const busy = saving || refreshing || installing !== null;

  function modelControl(kind, ids, value) {
    if (!ids.length) {
      return h(
        Button,
        {
          variant: "outline",
          size: "sm",
          disabled: busy,
          onClick: () => install(kind),
        },
        installing === kind ? t("settings.installing") : t("settings.install"),
      );
    }
    return h(SettingsSelector, {
      value,
      items: voiceChoiceItems(ids),
      disabled: busy,
      onSelect: (id) => patch(kind === "stt" ? { model: id } : { ttsModel: id }),
    });
  }

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
        t("settings.stt.title"),
        t("settings.stt.hint"),
        modelControl("stt", stt, sttValue),
      ),
      Row(
        t("settings.language.title"),
        t("settings.language.hint"),
        h(SettingsSelector, {
          value: voiceMenuValue(config.language),
          items: voiceLanguageItems(t("lang.auto")),
          disabled: busy,
          onSelect: (id) => patch({ language: voiceValueFromMenu(id) }),
        }),
      ),
      Row(
        t("settings.tts.title"),
        t("settings.tts.hint"),
        h(
          "div",
          { className: "lares-voice-controls" },
          h(Switch, {
            checked: config.speak === true,
            disabled: busy,
            label: t("settings.speak.label"),
            onChange: (next) => patch({ speak: next }),
          }),
          modelControl("tts", tts, ttsValue),
        ),
      ),
      h(BluetoothDevices, { t }),
    ),

    notice
      ? h("p", { className: `lares-settings-notice ${notice.kind === "error" ? "is-error" : ""}` }, notice.text)
      : null,
  );
}

/** Settings nav glyph, read off the component by the shell's row projection. */
VoiceSettings.navIcon = MicGlyph;
