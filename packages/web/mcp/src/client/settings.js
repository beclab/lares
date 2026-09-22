import React from "react";
import {
  Button,
  IconChevronLeftOutline14,
  IconLoadingOutline16,
  IconPlusOutline16,
  Input,
  StateDot,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { controlsCss, SettingsSelector } from "../../../shared/client/settings-controls.js";
import { useLatest, useMountedRef } from "../../../shared/client/react-lifecycle.js";
import {
  loadMcpSettings,
  rememberedMcpSettings,
  removeMcpServer,
  saveMcpServer,
} from "./api.js";
import { useT } from "./locale.js";
import localSettingsCss from "./styles/settings.css";

const { useCallback, useEffect, useState } = React;
const h = React.createElement;

export const settingsCss = `${controlsCss}${localSettingsCss}`;

const EMPTY_SERVER = {
  serverName: "",
  enabled: true,
  transport: "streamable-http",
  url: "",
  headers: {},
};

function jsonText(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

function parseJson(text, field, type, t) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(t("settings.invalidJson", { field }));
  }
  const valid = type === "array"
    ? Array.isArray(value)
    : value && typeof value === "object" && !Array.isArray(value);
  if (!valid) throw new Error(t("settings.invalidJson", { field }));
  return value;
}

function Field({ label, hint, block, tag = "label", children }) {
  return h(
    tag,
    { className: `lares-mcp-row${block ? " is-block" : ""}` },
    h(
      "div",
      { className: "lares-mcp-row-main" },
      h("span", { className: "lares-mcp-row-label" }, label),
      hint ? h("span", { className: "lares-mcp-row-hint" }, hint) : null,
    ),
    h("div", { className: "lares-mcp-row-control" }, children),
  );
}

function JsonField({ label, hint, value, disabled, onChange }) {
  return h(
    Field,
    { label, hint, block: true },
    h("textarea", {
      className: "lares-mcp-json",
      rows: 4,
      value,
      disabled,
      spellCheck: false,
      onChange: (event) => onChange(event.target.value),
    }),
  );
}

function ServerForm({ initial, previousName, busy, onCancel, onSave, t }) {
  const [serverName, setServerName] = useState(initial.serverName);
  const [transport, setTransport] = useState(initial.transport);
  const [url, setUrl] = useState(initial.url ?? "");
  const [headers, setHeaders] = useState(jsonText(initial.headers));
  const [command, setCommand] = useState(initial.command ?? "");
  const [args, setArgs] = useState(jsonText(initial.args ?? []));
  const [env, setEnv] = useState(jsonText(initial.env));
  const [cwd, setCwd] = useState(initial.cwd ?? "");
  const [error, setError] = useState("");

  const submit = useCallback(async () => {
    setError("");
    try {
      const server = transport === "streamable-http"
        ? {
            serverName,
            enabled: initial.enabled,
            transport,
            url,
            headers: parseJson(headers, t("settings.headers"), "object", t),
          }
        : {
            serverName,
            enabled: initial.enabled,
            transport,
            command,
            args: parseJson(args, t("settings.args"), "array", t),
            env: parseJson(env, t("settings.env"), "object", t),
            cwd,
          };
      await onSave(server, previousName);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [args, command, cwd, env, headers, initial.enabled, onSave, previousName, serverName, t, transport, url]);

  const transportItems = [
    { id: "streamable-http", label: t("settings.http") },
    { id: "stdio", label: t("settings.stdio") },
  ];

  return h(
    "section",
    { className: "lares-mcp lares-mcp-page" },
    h(
      Button,
      {
        variant: "ghost",
        size: "sm",
        className: "lares-mcp-back",
        icon: h(IconChevronLeftOutline14),
        disabled: busy,
        onClick: onCancel,
      },
      t("settings.back"),
    ),
    h(
      "div",
      { className: "lares-mcp-page-head" },
      h("h2", { className: "lares-settings-title" }, t(previousName ? "settings.formTitle.edit" : "settings.formTitle.add")),
      h("p", { className: "lares-settings-intro" }, t("settings.formIntro")),
    ),
    h(
      "div",
      { className: "lares-mcp-rows" },
      h(
        Field,
        { label: t("settings.serverName"), hint: t("settings.serverNameHint") },
        h(Input, {
          value: serverName,
          disabled: busy,
          placeholder: "my-server",
          onChange: (event) => setServerName(event.target.value),
        }),
      ),
      h(
        Field,
        { label: t("settings.transport"), hint: t("settings.transportHint"), tag: "div" },
        h(SettingsSelector, {
          value: transport,
          items: transportItems,
          disabled: busy,
          onSelect: setTransport,
        }),
      ),
      transport === "streamable-http"
        ? [
            h(
              Field,
              { key: "url", label: t("settings.url") },
              h(Input, {
                value: url,
                disabled: busy,
                placeholder: "https://example.com/mcp",
                onChange: (event) => setUrl(event.target.value),
              }),
            ),
            h(JsonField, {
              key: "headers",
              label: t("settings.headers"),
              hint: t("settings.headersHint"),
              value: headers,
              disabled: busy,
              onChange: setHeaders,
            }),
          ]
        : [
            h(
              Field,
              { key: "command", label: t("settings.command") },
              h(Input, {
                value: command,
                disabled: busy,
                placeholder: "npx",
                onChange: (event) => setCommand(event.target.value),
              }),
            ),
            h(JsonField, {
              key: "args",
              label: t("settings.args"),
              hint: t("settings.argsHint"),
              value: args,
              disabled: busy,
              onChange: setArgs,
            }),
            h(JsonField, {
              key: "env",
              label: t("settings.env"),
              hint: t("settings.envHint"),
              value: env,
              disabled: busy,
              onChange: setEnv,
            }),
            h(
              Field,
              { key: "cwd", label: t("settings.cwd") },
              h(Input, {
                value: cwd,
                disabled: busy,
                placeholder: "/data",
                onChange: (event) => setCwd(event.target.value),
              }),
            ),
          ],
    ),
    error ? h("p", { className: "lares-settings-notice is-error" }, error) : null,
    h(
      "div",
      { className: "lares-mcp-page-actions" },
      h(Button, { variant: "outline", size: "sm", disabled: busy, onClick: onCancel }, t("settings.cancel")),
      h(
        Button,
        {
          variant: "primary",
          size: "sm",
          disabled: busy,
          icon: busy ? h(IconLoadingOutline16, { className: "lares-mcp-spin" }) : undefined,
          onClick: submit,
        },
        t(busy ? "settings.saving" : "settings.save"),
      ),
    ),
  );
}

function ServerCard({ server, busy, onEdit, onToggle, onRemove, t }) {
  const enabled = server.enabled;
  const runtimeError = server.runtime?.state === "error";
  return h(
    "article",
    { className: `lares-mcp-card${enabled ? "" : " is-disabled"}` },
    h(
      "div",
      { className: "lares-mcp-card-head" },
      h(
        "div",
        { className: "lares-mcp-card-title" },
        h(StateDot, { state: runtimeError ? "warning" : enabled ? "done" : "idle", size: 8 }),
        h("strong", null, server.serverName),
        h("span", { className: "lares-mcp-transport" }, server.transport === "stdio" ? t("settings.stdio") : t("settings.http")),
        enabled ? null : h("span", { className: "lares-mcp-state" }, t("settings.disabled")),
      ),
      h(
        "div",
        { className: "lares-mcp-card-actions" },
        h(Button, { variant: "outline", size: "sm", disabled: busy, onClick: onEdit }, t("settings.edit")),
        h(
          Button,
          { variant: "outline", size: "sm", disabled: busy, onClick: onToggle },
          t(enabled ? "settings.disable" : "settings.enable"),
        ),
        h(Button, { variant: "outline", size: "sm", disabled: busy, onClick: onRemove }, t("settings.delete")),
      ),
    ),
    h(
      "code",
      { className: "lares-mcp-endpoint" },
      server.transport === "stdio" ? [server.command, ...(server.args ?? [])].join(" ") : server.url,
    ),
    runtimeError
      ? h("p", { className: "lares-mcp-runtime-error" }, t("settings.runtimeError", { msg: server.runtime.message }))
      : null,
  );
}

export function McpSettings() {
  const t = useT();
  const [state, setState] = useState(rememberedMcpSettings);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const mounted = useMountedRef();
  const translate = useLatest(t);

  useEffect(() => {
    let alive = true;
    loadMcpSettings()
      .then((next) => {
        if (alive) setState(next);
      })
      .catch((err) => {
        if (alive) setError(translate.current("settings.loadFailed", {
          msg: err instanceof Error ? err.message : String(err),
        }));
      });
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async (server, previousName = "") => {
    setBusy(previousName || server.serverName || "new");
    setError("");
    try {
      const next = await saveMcpServer(server, previousName);
      if (mounted.current) {
        setState(next);
        setEditing(null);
      }
    } catch (err) {
      if (mounted.current) throw err;
    } finally {
      if (mounted.current) setBusy("");
    }
  }, []);

  const toggle = useCallback(async (server) => {
    setBusy(server.serverName);
    setError("");
    try {
      const { runtime: _runtime, ...config } = server;
      const next = await saveMcpServer({ ...config, enabled: !server.enabled }, server.serverName);
      if (mounted.current) setState(next);
    } catch (err) {
      if (mounted.current) setError(t("settings.saveFailed", { msg: err instanceof Error ? err.message : String(err) }));
    } finally {
      if (mounted.current) setBusy("");
    }
  }, [t]);

  const remove = useCallback(async (server) => {
    if (!window.confirm(t("settings.confirmDelete", { name: server.serverName }))) return;
    setBusy(server.serverName);
    setError("");
    try {
      const next = await removeMcpServer(server.serverName);
      if (mounted.current) setState(next);
    } catch (err) {
      if (mounted.current) setError(t("settings.removeFailed", { msg: err instanceof Error ? err.message : String(err) }));
    } finally {
      if (mounted.current) setBusy("");
    }
  }, [t]);

  if (editing !== null) {
    return h(ServerForm, {
      key: editing.serverName || "new",
      initial: editing,
      previousName: editing.serverName,
      busy: Boolean(busy),
      onCancel: () => setEditing(null),
      onSave: save,
      t,
    });
  }

  return h(
    "div",
    { className: "lares-mcp" },
    h(
      "div",
      { className: "lares-settings-header" },
      h("h2", { className: "lares-settings-title" }, t("settings.title")),
      h(
        "div",
        { className: "lares-settings-actions" },
        h(
          Button,
          {
            variant: "outline",
            size: "sm",
            className: "lares-settings-action",
            icon: h(IconPlusOutline16, { size: 14 }),
            disabled: Boolean(busy),
            onClick: () => setEditing(EMPTY_SERVER),
          },
          t("settings.add"),
        ),
      ),
    ),
    h("p", { className: "lares-settings-intro" }, t("settings.intro")),
    state === null && !error ? h("p", { className: "lares-settings-notice" }, t("settings.loading")) : null,
    state?.error ? h("p", { className: "lares-settings-notice is-error" }, state.error) : null,
    h(
      "div",
      { className: "lares-mcp-list" },
      (state?.servers ?? []).map((server) =>
        h(ServerCard, {
          key: server.serverName,
          server,
          busy: Boolean(busy),
          t,
          onEdit: () => setEditing(server),
          onToggle: () => toggle(server),
          onRemove: () => remove(server),
        }),
      ),
    ),
    state !== null && state.servers.length === 0
      ? h("p", { className: "lares-settings-notice" }, t("settings.empty"))
      : null,
    error ? h("p", { className: "lares-settings-notice is-error" }, error) : null,
  );
}

function McpGlyph({ size = 16, className } = {}) {
  return h(
    "svg",
    { width: size, height: size, className, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
    h("circle", { cx: 4, cy: 8, r: 1.5, stroke: "currentColor", strokeWidth: 1.4 }),
    h("circle", { cx: 12, cy: 4, r: 1.5, stroke: "currentColor", strokeWidth: 1.4 }),
    h("circle", { cx: 12, cy: 12, r: 1.5, stroke: "currentColor", strokeWidth: 1.4 }),
    h("path", { d: "M5.5 7.25 10.5 4.7M5.5 8.75l5 2.55", stroke: "currentColor", strokeWidth: 1.4 }),
  );
}

McpSettings.navIcon = McpGlyph;
