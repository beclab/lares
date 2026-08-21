import React from "react";
import {
  controlsCss,
  SettingsHeader,
  SettingsSelector,
  SettingsStatus,
} from "../../../shared/client/settings-controls.js";
import { useLatest, useMountedRef } from "../../../shared/client/react-lifecycle.js";
import { API, getJson } from "./api.js";
import { MicGlyph } from "./icons.js";
import { useT } from "./locale.js";
import localSettingsCss from "./styles/settings.css";

const { useCallback, useEffect, useRef, useState } = React;
const h = React.createElement;

export const settingsCss = `${controlsCss}${localSettingsCss}`;

/** Menu selectedId cannot be empty. */
const AUTO = "auto";

/** Target-language names stay native; only the auto row is localized. */
function languageItems(t) {
  return [
    { id: AUTO, label: t("lang.auto") },
    { id: "zh", label: "中文" },
    { id: "en", label: "English" },
    { id: "ja", label: "日本語" },
    { id: "ko", label: "한국어" },
  ];
}

function Row(title, hint, control) {
  return h(
    "div",
    { className: "dina-voice-row" },
    h(
      "div",
      { className: "dina-voice-row-text" },
      h("div", { className: "dina-voice-row-title" }, title),
      hint ? h("div", { className: "dina-voice-hint" }, hint) : null,
    ),
    control,
  );
}

export function VoiceSettings() {
  const t = useT();
  const [config, setConfig] = useState(null);
  const [sttModels, setSttModels] = useState([]);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState(null);
  const mounted = useMountedRef();
  const refreshSequence = useRef(0);
  const translate = useLatest(t);

  useEffect(() => {
    return () => {
      refreshSequence.current += 1;
    };
  }, [mounted]);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setRefreshing(true);
    setNotice(null);
    try {
      const [next, models] = await Promise.all([getJson("/status"), getJson("/models")]);
      if (!mounted.current || sequence !== refreshSequence.current) return;
      setStatus(next);
      setSttModels(models.stt ?? []);
    } catch {
      if (mounted.current && sequence === refreshSequence.current) {
        setNotice({ kind: "error", text: translate.current("settings.refreshFailed") });
      }
    } finally {
      if (mounted.current && sequence === refreshSequence.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      let cfg;
      try {
        cfg = await getJson("/config");
      } catch {
        if (alive && mounted.current) {
          setConfig({ model: "", language: "" });
          setNotice({ kind: "error", text: translate.current("settings.loadFailed") });
        }
        return;
      }
      if (!alive) return;
      setConfig(cfg);
      if (mounted.current) await refresh();
    })();
    return () => {
      alive = false;
    };
  }, [refresh]);

  const patch = useCallback(async (key, value) => {
    if (!config) return;
    const previous = config;
    setConfig({ ...config, [key]: value });
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch(`${API}/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const next = await res.json();
      if (!mounted.current) return;
      setConfig(next);
      await refresh();
    } catch {
      if (mounted.current) {
        setConfig(previous);
        setNotice({ kind: "error", text: translate.current("settings.saveFailed") });
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, [config, refresh]);

  if (!config) {
    return h(
      "div",
      { className: "dina-voice" },
      h("div", { className: "dina-settings-notice" }, t("settings.loading")),
    );
  }

  const modelItems = [{ id: AUTO, label: t("settings.model.auto") }].concat(
    sttModels.map((id) => ({ id, label: id })),
  );
  const ready = Boolean(status?.modelAvailable);

  return h(
    "div",
    { className: "dina-voice" },
    h(SettingsHeader, {
      title: t("settings.title"),
      refreshing,
      disabled: refreshing || saving,
      onRefresh: refresh,
      routerRoute: "audio",
      t,
    }),
    h("p", { className: "dina-settings-intro" }, t("settings.intro")),
    h(
      SettingsStatus,
      { ready },
      ready
        ? t("settings.status.ready", { model: status?.model || t("status.auto") })
        : t("settings.status.notReady"),
    ),

    h(
      "div",
      { className: "dina-voice-rows" },
      Row(
        t("settings.model.title"),
        t("settings.model.hint"),
        h(SettingsSelector, {
          value: config.model || AUTO,
          items: modelItems,
          disabled: saving || refreshing,
          onSelect: (id) => patch("model", id === AUTO ? "" : id),
        }),
      ),
      Row(
        t("settings.language.title"),
        t("settings.language.hint"),
        h(SettingsSelector, {
          value: config.language || AUTO,
          items: languageItems(t),
          disabled: saving || refreshing,
          onSelect: (id) => patch("language", id === AUTO ? "" : id),
        }),
      ),
    ),

    notice
      ? h("p", { className: `dina-settings-notice ${notice.kind === "error" ? "is-error" : ""}` }, notice.text)
      : null,
  );
}

/** Settings nav glyph, read off the component by the shell's row projection. */
VoiceSettings.navIcon = MicGlyph;
