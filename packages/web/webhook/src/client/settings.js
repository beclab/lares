import React from "react";
import { Button, Input, Switch } from "@deepseek-ai/dsh-client-ui-primitives";
import { controlsCss } from "../../../shared/client/settings-controls.js";
import { useLatest, useMountedRef } from "../../../shared/client/react-lifecycle.js";
import { entranceOrigin, userDomainOf } from "@olares/lares-core/olares/entrance";
import { webhookCallUrls } from "@olares/lares-core/webhook/public";
import { loadWebhookSettings, rememberedWebhookSettings, saveWebhookSettings } from "./api.js";
import { useT } from "./locale.js";
import localSettingsCss from "./styles/settings.css";

const { useEffect, useState } = React;
const h = React.createElement;

export const settingsCss = `${controlsCss}${localSettingsCss}`;

function webhookEntranceOrigin() {
  if (typeof location === "undefined") return "";
  return entranceOrigin("webhook", {
    domain: userDomainOf(location.hostname),
    protocol: location.protocol,
  });
}

function contractText(origin) {
  const urls = webhookCallUrls(origin);
  return [
    `POST ${urls.post}`,
    '{"prompt":"..."}',
    "",
    `GET ${urls.jobs}<id>`,
  ].join("\n");
}

function Row({ label, hint, block, children }) {
  return h(
    "div",
    { className: `lares-webhook-row${block ? " is-block" : ""}` },
    h(
      "div",
      { className: "lares-webhook-copy" },
      h("div", { className: "lares-webhook-label" }, label),
      hint ? h("div", { className: "lares-webhook-hint" }, hint) : null,
    ),
    children,
  );
}

export function WebhookSettings() {
  const t = useT();
  const mounted = useMountedRef();
  const translate = useLatest(t);
  const remembered = rememberedWebhookSettings();
  const [enabled, setEnabled] = useState(remembered?.enabled === true);
  const [workspacePath, setWorkspacePath] = useState(remembered?.workspacePath ?? "");
  const [view, setView] = useState(remembered);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    loadWebhookSettings()
      .then((next) => {
        if (!alive) return;
        setView(next);
        setEnabled(next.enabled === true);
        setWorkspacePath(next.workspacePath ?? "");
      })
      .catch((err) => {
        if (alive && mounted.current) {
          setError(translate.current("settings.loadFailed", {
            msg: err instanceof Error ? err.message : String(err),
          }));
        }
      });
    return () => {
      alive = false;
    };
  }, [mounted, translate]);

  const origin = webhookEntranceOrigin();
  const sample = contractText(origin);

  const save = () => {
    setSaving(true);
    setError("");
    setNotice("");
    saveWebhookSettings({ enabled, workspacePath })
      .then((next) => {
        if (!mounted.current) return;
        setView(next);
        setEnabled(next.enabled === true);
        setWorkspacePath(next.workspacePath ?? "");
        setNotice(translate.current("settings.saved"));
      })
      .catch((err) => {
        if (!mounted.current) return;
        setError(translate.current("settings.saveFailed", {
          msg: err instanceof Error ? err.message : String(err),
        }));
      })
      .finally(() => {
        if (mounted.current) setSaving(false);
      });
  };

  const copy = () => {
    const write = navigator.clipboard?.writeText(sample);
    if (!write) return;
    write.then(() => {
      if (!mounted.current) return;
      setCopied(true);
      setTimeout(() => {
        if (mounted.current) setCopied(false);
      }, 1500);
    }).catch(() => {});
  };

  return h(
    "div",
    { className: "lares-webhook" },
    h("h2", { className: "lares-settings-title" }, t("settings.title")),
    h("p", { className: "lares-settings-intro" }, t("settings.intro")),
    h(
      "div",
      { className: "lares-webhook-card" },
      h(
        Row,
        { label: t("settings.enabled"), hint: t("settings.enabledHint") },
        h(Switch, {
          checked: enabled,
          disabled: saving,
          label: t("settings.enabled"),
          onChange: setEnabled,
        }),
      ),
      h(
        Row,
        { label: t("settings.workspace"), hint: t("settings.workspaceHint") },
        h(Input, {
          value: workspacePath,
          disabled: saving,
          placeholder: t("settings.workspacePlaceholder"),
          onChange: (event) => setWorkspacePath(event.target.value),
        }),
      ),
      h(
        Row,
        { label: t("settings.contract"), hint: t("settings.contractHint"), block: true },
        h("pre", { className: "lares-webhook-contract" }, sample),
        h(
          "div",
          { className: "lares-webhook-actions" },
          h(
            Button,
            { variant: "outline", size: "sm", onClick: copy },
            copied ? t("settings.copied") : t("settings.copy"),
          ),
          h(
            Button,
            { variant: "primary", size: "sm", disabled: saving, onClick: save },
            saving ? t("settings.saving") : t("settings.save"),
          ),
        ),
      ),
    ),
    error ? h("p", { className: "lares-webhook-note is-error" }, error) : null,
    notice ? h("p", { className: "lares-webhook-note" }, notice) : null,
  );
}
