import React from "react";
import {
  Button,
  Menu,
  StateDot,
  IconChevronDownOutline14,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { API, getJson } from "./api.js";
import { Spinner } from "./icons.js";
import { messageFor, useT } from "./locale.js";
import settingsCss from "./styles/settings.css";

const { useCallback, useEffect, useState } = React;
const h = React.createElement;

export { settingsCss };

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

/** Host returns when Market accepts the task, not when weights finish. */
function installNotice(t, payload) {
  if (!payload?.started) return t("install.ready", { model: payload?.model || t("status.auto") });
  return t("install.started", { app: payload.title || payload.app });
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

function Selector(props) {
  const [open, setOpen] = useState(false);
  const selected = props.items.find((item) => item.id === props.value);
  return h(Menu, {
    open,
    items: props.items,
    selectedId: props.value,
    onSelect: (id) => {
      setOpen(false);
      props.onSelect(id);
    },
    onClose: () => setOpen(false),
    align: "end",
    portal: true, // settings body scrolls; in-place menu would clip
    anchor: h(
      Button,
      {
        className: "dina-voice-selector",
        "aria-haspopup": "menu",
        "aria-expanded": open,
        onClick: () => setOpen((value) => !value),
      },
      h("span", { className: "dina-voice-selector-label" }, selected?.label ?? props.value),
      h(IconChevronDownOutline14, { className: "dina-voice-chevron" }),
    ),
  });
}

export function VoiceSettings() {
  const t = useT();
  const [config, setConfig] = useState(null);
  const [sttModels, setSttModels] = useState([]);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [notice, setNotice] = useState(null);

  const refresh = useCallback(async () => {
    const [next, models] = await Promise.all([
      getJson("/status").catch(() => null),
      getJson("/models").catch(() => null),
    ]);
    setStatus(next);
    if (models) setSttModels(models.stt ?? []);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const cfg = await getJson("/config").catch(() => ({ model: "", language: "" }));
      if (!alive) return;
      setConfig(cfg);
      await refresh();
    })();
    return () => {
      alive = false;
    };
  }, [refresh]);

  // Install is async; poll until the STT model shows up in the catalog.
  const pending = status !== null && !status.modelAvailable;
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setInterval(refresh, 8_000);
    return () => clearInterval(timer);
  }, [pending, refresh]);

  const patch = useCallback((key, value) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setNotice(null);
  }, []);

  const save = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch(`${API}/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error(String(res.status));
      setConfig(await res.json());
      setNotice({ kind: "ok", text: t("settings.saved") });
      await refresh();
    } catch {
      setNotice({ kind: "error", text: t("settings.saveFailed") });
    } finally {
      setSaving(false);
    }
  }, [config, refresh, t]);

  const install = useCallback(async () => {
    setInstalling(true);
    setNotice({ kind: "ok", text: t("settings.preparing") });
    try {
      const res = await fetch(`${API}/install`, { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error?.code ?? String(res.status));
      setNotice({ kind: "ok", text: installNotice(t, payload) });
      await refresh();
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      setNotice({ kind: "error", text: t("settings.installFailed", { msg: messageFor(t, code) }) });
    } finally {
      setInstalling(false);
    }
  }, [refresh, t]);

  if (!config) {
    return h("div", { className: "dina-voice" }, h("div", { className: "dina-voice-hint" }, t("loading")));
  }

  const modelItems = [{ id: AUTO, label: t("settings.model.auto") }].concat(
    sttModels.map((id) => ({ id, label: id })),
  );
  const ready = Boolean(status?.modelAvailable);

  return h(
    "div",
    { className: "dina-voice" },
    h("h2", { className: "dina-voice-title" }, t("settings.title")),
    h("p", { className: "dina-voice-intro" }, t("settings.intro")),
    h(
      "div",
      { className: `dina-voice-status ${ready ? "" : "is-warn"}` },
      h(StateDot, { state: ready ? "done" : "warning", size: 8 }),
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
        h(Selector, {
          value: config.model || AUTO,
          items: modelItems,
          onSelect: (id) => patch("model", id === AUTO ? "" : id),
        }),
      ),
      Row(
        t("settings.language.title"),
        t("settings.language.hint"),
        h(Selector, {
          value: config.language || AUTO,
          items: languageItems(t),
          onSelect: (id) => patch("language", id === AUTO ? "" : id),
        }),
      ),
    ),

    h(
      "div",
      { className: "dina-voice-actions" },
      h(
        Button,
        { variant: "primary", disabled: saving, onClick: save },
        saving ? t("settings.saving") : t("save"),
      ),
      h(
        Button,
        {
          variant: "outline",
          disabled: installing,
          onClick: install,
          icon: installing ? Spinner() : undefined,
        },
        installing ? t("settings.installing") : t("settings.install"),
      ),
    ),
    notice
      ? h("p", { className: `dina-voice-notice ${notice.kind === "error" ? "is-error" : "is-ok"}` }, notice.text)
      : null,
  );
}
