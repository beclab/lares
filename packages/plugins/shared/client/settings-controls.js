import React from "react";
import {
  Button,
  IconChevronDownOutline14,
  IconRefreshOutline14,
  IconRightUpOutline16,
  Menu,
  StateDot,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { openRouterConsole, routerConsoleUrl } from "./olares-entrance.js";
import controlsCss from "./settings-controls.css";

const { useState } = React;
const h = React.createElement;

export { controlsCss };

export function SettingsHeader({ title, refreshing, disabled, onRefresh, routerRoute, t }) {
  const routerUrl = routerConsoleUrl(routerRoute);
  return h(
    "div",
    { className: "lares-settings-header" },
    h("h2", { className: "lares-settings-title" }, title),
    h(
      "div",
      { className: "lares-settings-actions" },
      h(
        Button,
        {
          variant: "outline",
          size: "sm",
          className: "lares-settings-action",
          icon: h(IconRefreshOutline14),
          disabled,
          onClick: onRefresh,
        },
        refreshing ? t("settings.refreshing") : t("settings.refresh"),
      ),
      routerUrl
        ? h(
            Button,
            {
              variant: "outline",
              size: "sm",
              className: "lares-settings-action",
              // 该图标满幅且笔画更重，取 10 才与 14 的刷新图标墨量相当。
              icon: h(IconRightUpOutline16, { size: 10 }),
              onClick: () => openRouterConsole(routerRoute),
            },
            t("settings.router"),
          )
        : null,
    ),
  );
}

export function SettingsStatus({ ready, children }) {
  return h(
    "div",
    { className: `lares-settings-status${ready ? "" : " is-warn"}` },
    h(StateDot, { state: ready ? "done" : "warning", size: 8 }),
    children,
  );
}

export function SettingsSelector({ value, items, disabled, onSelect }) {
  const [open, setOpen] = useState(false);
  const selected = items.find((item) => item.id === value);
  return h(Menu, {
    open: disabled ? false : open,
    items,
    selectedId: value,
    onSelect: (id) => {
      setOpen(false);
      onSelect(id);
    },
    onClose: () => setOpen(false),
    align: "end",
    portal: true,
    anchor: h(
      Button,
      {
        className: "lares-settings-selector",
        "aria-haspopup": "menu",
        "aria-expanded": open,
        disabled,
        onClick: () => {
          if (!disabled) setOpen((value) => !value);
        },
      },
      h("span", { className: "lares-settings-selector-label" }, selected?.label ?? value),
      h(IconChevronDownOutline14, { className: "lares-settings-selector-chevron" }),
    ),
  });
}
