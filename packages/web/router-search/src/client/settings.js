import React from "react";
import {
  IconGlobeOutline14,
} from "@deepseek-ai/dsh-client-ui-primitives";
import {
  controlsCss,
  SettingsHeader,
  SettingsSelector,
  SettingsStatus,
} from "../../../shared/client/settings-controls.js";
import { watchCatalogRevision } from "../../../shared/client/catalog-events.js";
import { useLatest, useMountedRef } from "../../../shared/client/react-lifecycle.js";
import { loadSearchSettings, rememberedSearchSettings, saveSearchDefault } from "./api.js";
import {
  searchMenuValue,
  searchSelectorItems,
  searchStatus,
  searchValueFromMenu,
} from "@olares/lares-core/search/menu";
import { useT } from "./locale.js";
import localSettingsCss from "./styles/settings.css";

const { useCallback, useEffect, useState } = React;
const h = React.createElement;

export const settingsCss = `${controlsCss}${localSettingsCss}`;

export function WebSearchSettings() {
  const t = useT();
  const [config, setConfig] = useState(rememberedSearchSettings);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useMountedRef();
  const translate = useLatest(t);

  useEffect(() => {
    let alive = true;
    loadSearchSettings()
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
      loadSearchSettings({ force: true })
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
      const next = await loadSearchSettings({ force: true });
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
      const next = await saveSearchDefault(searchValueFromMenu(rawId));
      if (mounted.current) setConfig(next);
    } catch (err) {
      if (mounted.current) {
        setError(t("settings.saveFailed", { msg: err instanceof Error ? err.message : String(err) }));
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, [t]);

  const models = Array.isArray(config?.searchModels) ? config.searchModels : [];
  const items = searchSelectorItems(models, {
    routerDefault: t("settings.default.router"),
    off: t("settings.default.off"),
  });
  const disabled = !config || saving || refreshing;
  const value = searchMenuValue(config);
  const status = searchStatus(models, config);

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
WebSearchSettings.navIcon = IconGlobeOutline14;
