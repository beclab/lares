import React from "react";
import {
  Button,
  Input,
  Menu,
  StateDot,
  IconChevronDownOutline14,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { getJson, postJson } from "./api.js";
import { useT } from "./locale.js";
import settingsCss from "./styles/settings.css";

const { useCallback, useEffect, useState } = React;
const h = React.createElement;

export { settingsCss };

const NONE = "none";

function emptyDraft(publicCfg) {
  return {
    defaultProvider: publicCfg?.defaultProvider ?? null,
    providers: {
      tavily: {
        apiKey: "",
        hasApiKey: Boolean(publicCfg?.providers?.tavily?.hasApiKey),
        saved: Boolean(publicCfg?.providers?.tavily?.saved),
      },
      custom: {
        url: publicCfg?.providers?.custom?.url ?? "",
        apiKey: "",
        hasApiKey: Boolean(publicCfg?.providers?.custom?.hasApiKey),
        saved: Boolean(publicCfg?.providers?.custom?.saved),
      },
    },
  };
}

function applyPublic(prev, publicCfg) {
  if (!prev) return emptyDraft(publicCfg);
  return {
    defaultProvider: publicCfg?.defaultProvider ?? null,
    providers: {
      tavily: {
        ...prev.providers.tavily,
        apiKey: "",
        hasApiKey: Boolean(publicCfg?.providers?.tavily?.hasApiKey),
        saved: Boolean(publicCfg?.providers?.tavily?.saved),
      },
      custom: {
        ...prev.providers.custom,
        apiKey: "",
        url: publicCfg?.providers?.custom?.url ?? "",
        hasApiKey: Boolean(publicCfg?.providers?.custom?.hasApiKey),
        saved: Boolean(publicCfg?.providers?.custom?.saved),
      },
    },
  };
}

function Row(title, control, stacked, titleExtra) {
  return h(
    "div",
    { className: `dina-websearch-row${stacked ? " is-stack" : ""}` },
    h(
      "div",
      { className: "dina-websearch-row-text" },
      h("div", { className: "dina-websearch-row-title" }, title),
      titleExtra || null,
    ),
    control,
  );
}

function Selector(props) {
  const [open, setOpen] = useState(false);
  const selected = props.items.find((item) => item.id === props.value);
  return h(Menu, {
    open: props.disabled ? false : open,
    items: props.items,
    selectedId: props.value,
    onSelect: (id) => {
      setOpen(false);
      props.onSelect(id);
    },
    onClose: () => setOpen(false),
    align: "end",
    portal: true,
    anchor: h(
      Button,
      {
        className: "dina-websearch-selector",
        "aria-haspopup": "menu",
        "aria-expanded": open,
        disabled: props.disabled,
        onClick: () => {
          if (!props.disabled) setOpen((value) => !value);
        },
      },
      h("span", { className: "dina-websearch-selector-label" }, selected?.label ?? props.value),
      h(IconChevronDownOutline14, { className: "dina-websearch-chevron" }),
    ),
  });
}

function CardNotice(notice) {
  if (!notice) return null;
  return h(
    "p",
    { className: `dina-websearch-notice ${notice.kind === "error" ? "is-error" : "is-ok"}` },
    notice.text,
  );
}

export function WebSearchSettings() {
  const t = useT();
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(null);
  const [testing, setTesting] = useState(null);
  const [notices, setNotices] = useState({});

  useEffect(() => {
    let alive = true;
    getJson("/config")
      .then((cfg) => {
        if (alive) setDraft(emptyDraft(cfg));
      })
      .catch(() => {
        if (alive) setDraft(emptyDraft(null));
      });
    return () => {
      alive = false;
    };
  }, []);

  const setNotice = useCallback((id, notice) => {
    setNotices((prev) => ({ ...prev, [id]: notice }));
  }, []);

  const patchProvider = useCallback((id, key, value) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        providers: {
          ...prev.providers,
          [id]: { ...prev.providers[id], [key]: value },
        },
      };
    });
    setNotice(id, null);
  }, [setNotice]);

  const setDefault = useCallback(
    async (rawId) => {
      const id = rawId === NONE ? null : rawId;
      setNotice("default", null);
      try {
        const saved = await postJson("/config/default", { defaultProvider: id });
        setDraft((prev) => applyPublic(prev, saved));
      } catch {
        setNotice("default", { kind: "error", text: t("settings.defaultFailed") });
      }
    },
    [setNotice, t],
  );

  const save = useCallback(
    async (provider) => {
      if (!draft) return;
      setSaving(provider);
      setNotice(provider, null);
      try {
        const row = draft.providers[provider];
        const payload =
          provider === "tavily"
            ? {
                provider: "tavily",
                ...(row.apiKey.trim() ? { apiKey: row.apiKey.trim() } : {}),
              }
            : {
                provider: "custom",
                url: row.url.trim(),
                ...(row.apiKey.trim() ? { apiKey: row.apiKey.trim() } : {}),
              };
        const result = await postJson("/config/provider", payload);
        if (result.config) setDraft((prev) => applyPublic(prev, result.config));
        setNotice(provider, { kind: "ok", text: t("settings.saved") });
      } catch (err) {
        setNotice(provider, {
          kind: "error",
          text: t("settings.saveFailed", { msg: err instanceof Error ? err.message : String(err) }),
        });
      } finally {
        setSaving(null);
      }
    },
    [draft, setNotice, t],
  );

  const test = useCallback(
    async (provider) => {
      if (!draft) return;
      setTesting(provider);
      setNotice(provider, null);
      try {
        const row = draft.providers[provider];
        const body =
          provider === "tavily"
            ? {
                provider: "tavily",
                ...(row.apiKey.trim() ? { apiKey: row.apiKey.trim() } : {}),
              }
            : {
                provider: "custom",
                url: row.url.trim(),
                ...(row.apiKey.trim() ? { apiKey: row.apiKey.trim() } : {}),
              };
        const result = await postJson("/test", body);
        if (!result.ok) throw new Error(result.error || "probe failed");
        const sample = result.sample ? ` · ${result.sample}` : "";
        setNotice(provider, {
          kind: "ok",
          text: t("settings.testOk", { ms: String(result.latencyMs ?? 0), sample }),
        });
      } catch (err) {
        setNotice(provider, {
          kind: "error",
          text: t("settings.testFailed", { msg: err instanceof Error ? err.message : String(err) }),
        });
      } finally {
        setTesting(null);
      }
    },
    [draft, setNotice, t],
  );

  if (!draft) {
    return h("div", { className: "dina-websearch" }, h("div", { className: "dina-websearch-intro" }, t("loading")));
  }

  const savedItems = [
    { id: NONE, label: t("settings.default.none") },
    ...(draft.providers.tavily.saved ? [{ id: "tavily", label: t("provider.tavily") }] : []),
    ...(draft.providers.custom.saved ? [{ id: "custom", label: t("provider.custom") }] : []),
  ];
  const defaultValue = draft.defaultProvider ?? NONE;
  const defaultDisabled = !draft.providers.tavily.saved && !draft.providers.custom.saved;

  return h(
    "div",
    { className: "dina-websearch" },
    h("h2", { className: "dina-websearch-title" }, t("settings.title")),
    h("p", { className: "dina-websearch-intro" }, t("settings.intro")),

    Row(
      t("settings.default"),
      h(Selector, {
        value: defaultDisabled ? NONE : defaultValue,
        items: defaultDisabled
          ? [{ id: NONE, label: t("settings.default.empty") }]
          : savedItems,
        disabled: defaultDisabled,
        onSelect: setDefault,
      }),
    ),
    CardNotice(notices.default),

    h(
      "div",
      { className: "dina-websearch-card" },
      h(
        "div",
        { className: "dina-websearch-card-head" },
        h("h3", { className: "dina-websearch-card-title" }, t("provider.tavily")),
        h(
          "span",
          { className: "dina-websearch-card-badge" },
          h(StateDot, {
            state: draft.providers.tavily.saved ? "done" : "warning",
            size: 8,
          }),
          draft.providers.tavily.saved ? t("provider.saved") : t("provider.unsaved"),
        ),
      ),
      Row(
        t("provider.apiKey"),
        h(Input, {
          className: "dina-websearch-field",
          type: "password",
          autoComplete: "off",
          value: draft.providers.tavily.apiKey,
          onChange: (event) => patchProvider("tavily", "apiKey", event.target.value),
        }),
        true,
        h(StateDot, {
          state: draft.providers.tavily.hasApiKey ? "done" : "warning",
          size: 8,
        }),
      ),
      h(
        "div",
        { className: "dina-websearch-actions" },
        h(
          Button,
          {
            variant: "outline",
            disabled: testing === "tavily" || saving === "tavily",
            onClick: () => test("tavily"),
          },
          testing === "tavily" ? t("settings.testing") : t("settings.test"),
        ),
        h(
          Button,
          {
            variant: "primary",
            disabled: saving === "tavily" || testing === "tavily",
            onClick: () => save("tavily"),
          },
          saving === "tavily" ? t("settings.saving") : t("settings.save"),
        ),
        CardNotice(notices.tavily),
      ),
    ),

    h(
      "div",
      { className: "dina-websearch-card" },
      h(
        "div",
        { className: "dina-websearch-card-head" },
        h("h3", { className: "dina-websearch-card-title" }, t("provider.custom")),
        h(
          "span",
          { className: "dina-websearch-card-badge" },
          h(StateDot, {
            state: draft.providers.custom.saved ? "done" : "warning",
            size: 8,
          }),
          draft.providers.custom.saved ? t("provider.saved") : t("provider.unsaved"),
        ),
      ),
      Row(
        t("provider.url"),
        h(Input, {
          className: "dina-websearch-field",
          type: "url",
          value: draft.providers.custom.url,
          onChange: (event) => patchProvider("custom", "url", event.target.value),
        }),
        true,
      ),
      Row(
        t("provider.apiKey"),
        h(Input, {
          className: "dina-websearch-field",
          type: "password",
          autoComplete: "off",
          value: draft.providers.custom.apiKey,
          onChange: (event) => patchProvider("custom", "apiKey", event.target.value),
        }),
        true,
        h(StateDot, {
          state: draft.providers.custom.hasApiKey ? "done" : "warning",
          size: 8,
        }),
      ),
      h(
        "div",
        { className: "dina-websearch-actions" },
        h(
          Button,
          {
            variant: "outline",
            disabled: testing === "custom" || saving === "custom",
            onClick: () => test("custom"),
          },
          testing === "custom" ? t("settings.testing") : t("settings.test"),
        ),
        h(
          Button,
          {
            variant: "primary",
            disabled: saving === "custom" || testing === "custom",
            onClick: () => save("custom"),
          },
          saving === "custom" ? t("settings.saving") : t("settings.save"),
        ),
        CardNotice(notices.custom),
      ),
    ),
  );
}

/** Shadow the official DeepSeek web-search plugin card. */
export function HideOfficialWebSearchCard() {
  return null;
}
