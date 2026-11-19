import React from "react";
import {
  IconGlobeOutlineRegular,
} from "@deepseek-ai/dsh-client-ui-primitives";
import {
  controlsCss,
  SettingsHeader,
  SettingsSelector,
  SettingsStatus,
} from "../../../shared/client/settings-controls.js";
import { watchCatalogRevision } from "../../../shared/client/catalog-events.js";
import { useLatest, useMountedRef } from "../../../shared/client/react-lifecycle.js";
import { loadFetchSettings, rememberedFetchSettings, saveFetchDefault } from "@olares/lares-core/fetch/client";
import {
  fetchMenuValue,
  fetchSelectorItems,
  fetchStatus,
  fetchValueFromMenu,
} from "@olares/lares-core/fetch/menu";
import { useT } from "./fetch-locale.js";
import localSettingsCss from "./styles/settings.css";

const { useCallback, useEffect, useState } = React;
const h = React.createElement;

export const settingsCss = `${controlsCss}${localSettingsCss}`;

export function WebFetchSettings() {
  const t = useT();
  const [config, setConfig] = useState(rememberedFetchSettings);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useMountedRef();
  const translate = useLatest(t);

  useEffect(() => {
    let alive = true;
    loadFetchSettings()
      .then((next) => {
        if (alive) setConfig(next);
      })
      .catch((err) => {
        if (alive) {
          setError(translate.current("settings.loadFailed", {
            msg: err instanceof Error ? err.message : String(err),
          }));
        }
      });
    const stop = watchCatalogRevision(() => {
      loadFetchSettings({ force: true })
        .then((next) => {
          if (alive) setConfig(next);
        })
        .catch(() => {});
    });
    return () => {
      alive = false;
      stop();
    };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      const next = await loadFetchSettings({ force: true });
      if (mounted.current) setConfig(next);
    } catch (err) {
      if (mounted.current) {
        setError(t("settings.refreshFailed", { msg: err instanceof Error ? err.message : String(err) }));
      }
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [t]);

  const setDefault = useCallback(async (rawId) => {
    setSaving(true);
    setError("");
    try {
      const next = await saveFetchDefault(fetchValueFromMenu(rawId));
      if (mounted.current) setConfig(next);
    } catch (err) {
      if (mounted.current) {
        setError(t("settings.saveFailed", { msg: err instanceof Error ? err.message : String(err) }));
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, [t]);

  const models = Array.isArray(config?.fetchModels) ? config.fetchModels : [];
  const items = fetchSelectorItems(models, {
    routerDefault: t("settings.default.router"),
    off: t("settings.default.off"),
  });
  const disabled = !config || saving || refreshing;
  const value = fetchMenuValue(config);
  const status = fetchStatus(models, config);

  return h(
    "div",
    { className: "lares-websearch" },
    h(SettingsHeader, {
      title: t("settings.title"),
      refreshing,
      disabled: refreshing || saving,
      onRefresh: refresh,
      routerRoute: "tools",
      t,
    }),
    h("p", { className: "lares-settings-intro" }, t("settings.intro")),
    config === null && error === ""
      ? h("p", { className: "lares-settings-notice" }, t("settings.loading"))
      : null,
    config === null
      ? null
      : h(
          SettingsStatus,
          { ready: status.ready },
          t(status.key, status.model ? { model: status.model } : undefined),
        ),
    h(
      "div",
      { className: "lares-websearch-row" },
      h(
        "div",
        { className: "lares-websearch-row-text" },
        h("div", { className: "lares-websearch-row-title" }, t("settings.default")),
      ),
      h(SettingsSelector, {
        value,
        items,
        disabled,
        onSelect: setDefault,
      }),
    ),
    error ? h("p", { className: "lares-settings-notice is-error" }, error) : null,
  );
}

/** Settings nav glyph, read off the component by the shell's row projection. */
WebFetchSettings.navIcon = IconGlobeOutlineRegular;
