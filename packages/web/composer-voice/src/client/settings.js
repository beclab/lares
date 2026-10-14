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
import { installVoiceChart, loadVoiceSettings, rememberedVoiceSettings, saveVoiceSettings, voiceChartAction } from "./api.js";
import {
  EMPTY_VOICE_CONFIG,
  selectedVoice,
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
  const [acting, setActing] = useState(null);
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
      if (mounted.current) setView(next);
    } catch {
      if (mounted.current) setNotice({ kind: "error", text: translate.current("settings.installFailed") });
    } finally {
      if (mounted.current) setInstalling(null);
    }
  }, []);

  const act = useCallback(async (kind, op) => {
    setActing({ kind, op });
    setNotice(null);
    try {
      const next = await voiceChartAction(kind, op);
      if (!mounted.current) return;
      setView(next);
      if (op === "probe") setNotice({ kind: "info", text: translate.current("settings.probeOk") });
    } catch {
      if (!mounted.current) return;
      const key = op === "probe"
        ? "settings.probeFailed"
        : op === "stop"
          ? "settings.stopFailed"
          : "settings.resumeFailed";
      setNotice({ kind: "error", text: translate.current(key) });
    } finally {
      if (mounted.current) setActing(null);
    }
  }, []);

  useEffect(() => {
    const charts = view?.charts;
    if (!charts || (charts.stt?.phase !== "busy" && charts.tts?.phase !== "busy")) return undefined;
    const timer = setInterval(() => {
      loadVoiceSettings({ force: true }).then((next) => {
        if (mounted.current) setView(next);
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [view?.charts?.stt?.phase, view?.charts?.tts?.phase]);

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

  const { config, status } = view;
  const ready = voiceStatusReady(status);
  const busy = saving || refreshing || installing !== null || acting !== null;

  function modelControl(kind) {
    const phase = view.charts?.[kind]?.phase ?? "absent";
    if (phase === "running" || phase === "stopped") {
      const probing = acting?.kind === kind && acting.op === "probe";
      const power = phase === "stopped" ? "resume" : "stop";
      const powering = acting?.kind === kind && acting.op === power;
      return [
        h(Button, {
          key: `${kind}-probe`,
          variant: "outline",
          size: "sm",
          disabled: busy,
          onClick: () => act(kind, "probe"),
        }, probing ? t("settings.probing") : t("settings.probe")),
        h(Button, {
          key: `${kind}-power`,
          variant: "outline",
          size: "sm",
          disabled: busy,
          onClick: () => act(kind, power),
        }, powering
          ? t(power === "resume" ? "settings.resuming" : "settings.stopping")
          : t(power === "resume" ? "settings.resume" : "settings.stop")),
      ];
    }
    return h(
      Button,
      {
        variant: "outline",
        size: "sm",
        disabled: busy || phase === "busy",
        onClick: () => install(kind),
      },
      installing === kind || phase === "busy" ? t("settings.installing") : t("settings.install"),
    );
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
        t("settings.stt.title"),
        t("settings.stt.hint"),
        modelControl("stt"),
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
          modelControl("tts"),
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
