import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { createLocaleBinding } from "../../../shared/client/locale-binding.js";

const h = React.createElement;

const ZH = {
  "reasoning.default": "默认",
  "reasoning.title": "推理等级",
  "reasoning.switchAria": "切换推理等级，当前 {label}",
  "model.select": "选择模型",
  "model.switchAria": "切换模型，当前 {label}",
  "model.menuAria": "模型",
  "model.refreshing": "正在刷新模型列表…",
  "model.opFailed": "模型操作失败：{msg}",
  "model.loadFailed": "{name} 加载失败：{msg}",
  "model.empty": "没有可用的模型。",
  "slot.model": "模型",
};

const EN = {
  "reasoning.default": "Default",
  "reasoning.title": "Reasoning effort",
  "reasoning.switchAria": "Switch reasoning effort, current {label}",
  "model.select": "Select model",
  "model.switchAria": "Switch model, current {label}",
  "model.menuAria": "Model",
  "model.refreshing": "Refreshing models…",
  "model.opFailed": "Model action failed: {msg}",
  "model.loadFailed": "{name} failed to load: {msg}",
  "model.empty": "No models available.",
  "slot.model": "Model",
};

const localeBinding = createLocaleBinding("lares.chat-model.switch");

export function bindLocale(locale) {
  localeBinding.attach(locale);
  localeBinding.bind(locale);
}

export function registerLocale(locale) {
  return locale.register("lares.chat-model.switch", { zh: ZH, en: EN });
}

export function t(key, params) {
  return localeBinding.getTranslate()(key, params);
}

const useT = localeBinding.useT;

function ChevronGlyph(open) {
  return h(
    "svg",
    {
      className: `lares-model-chevron${open ? " is-open" : ""}`,
      width: 14,
      height: 14,
      viewBox: "0 0 16 16",
      fill: "none",
      "aria-hidden": "true",
    },
    h("path", {
      d: "M4 6.5 8 10.5 12 6.5",
      stroke: "currentColor",
      strokeWidth: 1.4,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    }),
  );
}

function CheckGlyph() {
  return h(
    "svg",
    { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
    h("path", {
      d: "M3.5 8.5 6.5 11.5 12.5 4.5",
      stroke: "currentColor",
      strokeWidth: 1.6,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    }),
  );
}

function Option(key, name, description, selected, disabled, onClick) {
  return h(
    "button",
    {
      key,
      type: "button",
      role: "menuitemradio",
      "aria-checked": selected,
      className: "lares-model-option",
      disabled,
      onClick,
    },
    h(
      "span",
      { className: "lares-model-option-copy" },
      h("span", { className: "lares-model-option-name" }, name),
      description ? h("span", { className: "lares-model-option-desc" }, description) : null,
    ),
    h("span", { className: "lares-model-check" }, selected ? CheckGlyph() : null),
  );
}

/** Hero: re-seat model chip into the workspace row (first menu popup under composer seat). */
function findHeroRow() {
  const seat = document.querySelector('[data-phase="hero"] [data-composer-seat]');
  return seat?.querySelector('button[aria-haspopup="menu"]')?.parentElement ?? null;
}

function useHeroRow() {
  const [row, setRow] = useState(null);
  useEffect(() => {
    let frame = 0;
    const sync = () => {
      frame = 0;
      setRow((current) => {
        const next = findHeroRow();
        return next === current ? current : next;
      });
    };
    sync();
    // data-phase flips mount/retire the hero row; coalesce to one rAF.
    const observer = new MutationObserver(() => {
      if (frame === 0) frame = requestAnimationFrame(sync);
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-phase"],
    });
    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);
  return row;
}

/** Model chip in composer dock (and hero workspace row); state still owned by ui-model-selection. */
export function ModelSwitch({ available, directory, load, select, locked }) {
  const t = useT();
  const heroRow = useHeroRow();
  const subscribe = useCallback((fn) => directory.subscribe(fn), [directory]);
  const snapshot = useCallback(() => directory.getSnapshot(), [directory]);
  const state = useSyncExternalStore(subscribe, snapshot);
  const [openMenu, setOpenMenu] = useState(null);
  const rootRef = useRef(null);

  useEffect(() => {
    if (available) load();
  }, [available, load]);

  useEffect(() => {
    if (openMenu === null) return;
    const closeOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpenMenu(null);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [openMenu]);

  if (!available) return null;

  const current = state.current;
  let currentModel;
  for (const group of state.groups) {
    for (const model of group.models) {
      if (current && group.id === current.provider && model.id === current.model) currentModel = model;
    }
  }
  const reasoning = currentModel?.reasoning;
  const effort = current?.reasoningEffort ?? reasoning?.defaultEffort;
  const effortLabel =
    reasoning === undefined
      ? undefined
      : effort === undefined
        ? t("reasoning.default")
        : (reasoning.efforts.find((level) => level.id === effort)?.name ?? effort);
  const label = currentModel?.name ?? current?.model ?? t("model.select");
  const busy = state.status === "selecting";

  const submit = (selection) => {
    select(selection).then((accepted) => {
      if (accepted) setOpenMenu(null);
    });
  };

  const chooseModel = (group, model) => {
    if (current?.provider === group.id && current.model === model.id) {
      setOpenMenu(null);
      return;
    }
    submit({
      provider: group.id,
      model: model.id,
      ...(model.reasoning?.defaultEffort === undefined
        ? {}
        : { reasoningEffort: model.reasoning.defaultEffort }),
    });
  };

  const chooseEffort = (level) => {
    if (!current || effort === level) {
      setOpenMenu(null);
      return;
    }
    submit({
      provider: current.provider,
      model: current.model,
      ...(level === undefined ? {} : { reasoningEffort: level }),
    });
  };

  const efforts =
    reasoning === undefined
      ? []
      : [
          ...(reasoning.defaultEffort === undefined
            ? [{ key: "provider-default", id: undefined, name: t("reasoning.default") }]
            : []),
          ...reasoning.efforts,
        ];

  const toggle = (menu) => setOpenMenu((current) => (current === menu ? null : menu));

  const modelOpen = openMenu === "model";
  const effortOpen = openMenu === "effort";

  const trigger = h(
    "button",
    {
      type: "button",
      className: "lares-model-trigger",
      "aria-haspopup": "menu",
      "aria-expanded": modelOpen,
      "aria-label": current ? t("model.switchAria", { label }) : t("model.select"),
      title: label,
      disabled: locked,
      onClick: () => {
        toggle("model");
        if (!modelOpen) load();
      },
    },
    h("span", { className: "lares-model-label" }, label),
    ChevronGlyph(modelOpen),
  );

  const menu = modelOpen
    ? h(
        "div",
        {
          className: "lares-model-menu",
          role: "menu",
          "aria-label": t("model.menuAria"),
          "aria-busy": state.status === "loading" || busy,
        },
        state.status === "loading" ? h("div", { className: "lares-model-note" }, t("model.refreshing")) : null,
        state.error === null
          ? null
          : h(
              "div",
              { className: "lares-model-note is-error" },
              t("model.opFailed", { msg: state.error }),
              h("button", { type: "button", className: "lares-model-retry", onClick: load }, t("retry")),
            ),
        state.failures.map((failure) =>
          h(
            "div",
            { key: failure.id, className: "lares-model-note" },
            t("model.loadFailed", { name: failure.name, msg: failure.message }),
          ),
        ),
        state.groups.map((group) =>
          h(
            "section",
            { key: group.id, className: "lares-model-group", role: "group" },
            h("div", { className: "lares-model-group-title" }, group.name),
            group.models.map((model) =>
              Option(
                model.id,
                model.name,
                model.description,
                current?.provider === group.id && current.model === model.id,
                busy,
                () => chooseModel(group, model),
              ),
            ),
          ),
        ),
        state.status === "ready" && state.groups.length === 0
          ? h("div", { className: "lares-model-note" }, t("model.empty"))
          : null,
      )
    : null;

  const effortTrigger =
    efforts.length === 0
      ? null
      : h(
          "button",
          {
            type: "button",
            className: "lares-model-trigger is-effort",
            "aria-haspopup": "menu",
            "aria-expanded": effortOpen,
            "aria-label": t("reasoning.switchAria", { label: effortLabel }),
            title: `${t("reasoning.title")} · ${effortLabel}`,
            disabled: locked,
            onClick: () => toggle("effort"),
          },
          h("span", { className: "lares-model-label" }, effortLabel),
          ChevronGlyph(effortOpen),
        );

  const effortMenu =
    effortOpen && efforts.length > 0
      ? h(
          "div",
          {
            className: "lares-model-menu is-effort",
            role: "menu",
            "aria-label": t("reasoning.title"),
            "aria-busy": busy,
          },
          h("div", { className: "lares-model-group-title" }, t("reasoning.title")),
          efforts.map((level) =>
            Option(
              level.key ?? `effort:${level.id}`,
              level.name,
              level.description,
              effort === level.id,
              busy,
              () => chooseEffort(level.id),
            ),
          ),
        )
      : null;

  const row = h(
    "div",
    { ref: rootRef, className: heroRow === null ? "lares-model-row" : "lares-model-row is-hero" },
    effortTrigger === null
      ? null
      : h("div", { className: "lares-model-anchor" }, effortTrigger, effortMenu),
    h("div", { className: "lares-model-anchor" }, trigger, menu),
  );

  return heroRow === null ? h("div", { className: "lares-model" }, row) : createPortal(row, heroRow);
}


export function HideModelSeat() {
  return null;
}
