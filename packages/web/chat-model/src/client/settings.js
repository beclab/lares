import React from "react";
import {
  IconCheckOutline16,
  IconLoadingOutline16,
} from "@deepseek-ai/dsh-client-ui-primitives";
import {
  controlsCss,
  SettingsHeader,
  SettingsStatus,
} from "../../../shared/client/settings-controls.js";
import { useLatest, useMountedRef } from "../../../shared/client/react-lifecycle.js";
import { loadModelSettings, rememberedModelSettings, refreshModels, setDefaultModel } from "./api.js";
import { useT } from "./locale.js";
import { catalogDefaultReady, groupModelsByProvider, selectionKey } from "@lares/core/router/session-model";
import localSettingsCss from "./styles/settings.css";

const { useCallback, useEffect, useState } = React;
const h = React.createElement;

export const settingsCss = `${controlsCss}${localSettingsCss}`;

function ModelRow({ model, selected, busy, disabled, onSelect, t }) {
  return h(
    "button",
    {
      type: "button",
      role: "radio",
      "aria-checked": selected,
      className: `lares-models-item${selected ? " is-default" : ""}`,
      disabled,
      onClick: onSelect,
      title: selected ? t("settings.default") : t("settings.setDefault"),
    },
    h(
      "span",
      { className: "lares-models-item-copy" },
      h("span", { className: "lares-models-item-name" }, model.name),
      model.description ? h("span", { className: "lares-models-item-desc" }, model.description) : null,
    ),
    busy
      ? h(IconLoadingOutline16, { className: "lares-models-spinner" })
      : selected
        ? h(
            "span",
            { className: "lares-models-badge" },
            h(IconCheckOutline16, null),
            h("span", null, t("settings.default")),
          )
        : null,
  );
}

export function ModelsSettings() {
  const t = useT();
  const [state, setState] = useState(rememberedModelSettings);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useMountedRef();
  const translate = useLatest(t);

  useEffect(() => {
    let alive = true;
    loadModelSettings()
      .then((next) => {
        if (alive) setState(next);
      })
      .catch((err) => {
        if (alive) {
          setError(translate.current("settings.loadFailed", {
            msg: err instanceof Error ? err.message : String(err),
          }));
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      const next = await refreshModels();
      if (mounted.current) setState(next);
    } catch (err) {
      if (mounted.current) {
        setError(t("settings.refreshFailed", { msg: err instanceof Error ? err.message : String(err) }));
      }
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [t]);

  const choose = useCallback(
    async (model) => {
      const selection = { provider: model.provider, model: model.id };
      setPending(selectionKey(selection));
      setError("");
      try {
        const next = await setDefaultModel(selection);
        if (mounted.current) setState(next);
      } catch (err) {
        if (mounted.current) {
          setError(t("settings.saveFailed", { msg: err instanceof Error ? err.message : String(err) }));
        }
      } finally {
        if (mounted.current) setPending("");
      }
    },
    [t],
  );

  const current = state?.default ? selectionKey(state.default) : "";
  const groups = groupModelsByProvider(state?.models ?? []);
  const ready = catalogDefaultReady(state?.models ?? [], state?.default);

  return h(
    "div",
    { className: "lares-models" },
    h(SettingsHeader, {
      title: t("settings.title"),
      refreshing,
      disabled: refreshing || pending !== "",
      onRefresh: refresh,
      routerRoute: "llm",
      t,
    }),
    h("p", { className: "lares-settings-intro" }, t("settings.intro")),
    state === null
      ? null
      : h(
          SettingsStatus,
          { ready },
          ready
            ? t("settings.status.ready", { model: state.default.model })
            : t("settings.status.notReady"),
        ),

    state === null && error === ""
      ? h("p", { className: "lares-settings-notice" }, t("settings.loading"))
      : null,

    h(
      "div",
      { role: "radiogroup", "aria-label": t("settings.listAria") },
      groups.map((group) =>
        h(
          "section",
          { key: group.provider, className: "lares-models-group" },
          h(
            "div",
            { className: "lares-models-list" },
            group.models.map((model) => {
              const key = selectionKey({ provider: model.provider, model: model.id });
              return h(ModelRow, {
                key,
                model,
                t,
                selected: key === current,
                busy: key === pending,
                disabled: pending !== "",
                onSelect: () => {
                  if (key !== current) choose(model);
                },
              });
            }),
          ),
        ),
      ),
    ),

    state !== null && groups.length === 0
      ? h("p", { className: "lares-settings-notice" }, t("settings.empty"))
      : null,

    (state?.failures ?? []).map((entry) =>
      h(
        "p",
        { key: entry.provider, className: "lares-settings-notice is-error" },
        t("settings.providerFailed", { name: entry.name || entry.provider, msg: entry.message }),
      ),
    ),

    error ? h("p", { className: "lares-settings-notice is-error" }, error) : null,
  );
}
