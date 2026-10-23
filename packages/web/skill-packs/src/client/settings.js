import React from "react";
import { Button, IconLoadingOutlineMedium, Input } from "@deepseek-ai/dsh-client-ui-primitives";
import { OFFICIAL_PACKS } from "@olares/lares-core/skills/packs";
import { controlsCss } from "../../../shared/client/settings-controls.js";
import { useLatest, useMountedRef } from "../../../shared/client/react-lifecycle.js";
import {
  disableSkillPack,
  downloadSkillPack,
  enableSkillPack,
  loadSkillPacks,
  rememberedSkillPacks,
  saveSkillConnection,
} from "./api.js";
import { useT } from "./locale.js";
import localSettingsCss from "./styles/settings.css";

const { useCallback, useEffect, useState } = React;
const h = React.createElement;

export const settingsCss = `${controlsCss}${localSettingsCss}`;

/** Which packs exist is a build-time fact, so the cards never wait on the host. */
const PACK_IDS = OFFICIAL_PACKS.map((pack) => pack.id);
const CONFIGURABLE = new Set(OFFICIAL_PACKS.filter((pack) => pack.cli).map((pack) => pack.id));

function packAction(status) {
  if (!status.downloaded) {
    return { variant: "primary", idle: "settings.download", pending: "settings.downloading", handler: "onDownload" };
  }
  return status.enabled
    ? { variant: "outline", idle: "settings.disable", pending: "settings.disabling", handler: "onDisable" }
    : { variant: "primary", idle: "settings.enable", pending: "settings.enabling", handler: "onEnable" };
}

function TokenForm({ id, status, busy, t, onSave }) {
  const [open, setOpen] = useState(false);
  const [server, setServer] = useState(status?.connection?.server ?? "");
  const [token, setToken] = useState("");
  const knownServer = status?.connection?.server ?? "";

  useEffect(() => {
    if (knownServer) setServer((current) => current || knownServer);
  }, [knownServer]);

  const saving = busy === `${id}:token`;
  const save = () => {
    if (saving || busy) return;
    onSave(server, token).then((ok) => {
      if (ok) {
        setToken("");
        setOpen(false);
      }
    });
  };
  const saveOnEnter = (event) => {
    if (event.key === "Enter") save();
  };
  return h(
    "div",
    { className: "lares-skills-token" },
    h(
      "div",
      { className: "lares-skills-token-bar" },
      knownServer
        ? h("p", { className: "lares-skills-connected" }, t("settings.connected", { server: knownServer }))
        : h("p", { className: "lares-skills-hint" }, t("settings.tokenHint")),
      h(
        Button,
        {
          variant: "outline",
          size: "sm",
          disabled: Boolean(busy),
          onClick: () => setOpen((current) => !current),
        },
        t(open ? "settings.tokenHide" : "settings.token"),
      ),
    ),
    open
      ? h(
          "div",
          { className: "lares-skills-token-form" },
          h(
            "label",
            { className: "lares-skills-field" },
            h("span", { className: "lares-skills-label" }, t("settings.server")),
            h(Input, {
              value: server,
              disabled: saving,
              placeholder: t("settings.serverPlaceholder"),
              autoComplete: "off",
              onChange: (event) => setServer(event.target.value),
              onKeyDown: saveOnEnter,
            }),
          ),
          h(
            "label",
            { className: "lares-skills-field" },
            h("span", { className: "lares-skills-label" }, t("settings.tokenLabel")),
            h(Input, {
              type: "password",
              value: token,
              disabled: saving,
              placeholder: t("settings.tokenPlaceholder"),
              autoComplete: "off",
              spellCheck: false,
              onChange: (event) => setToken(event.target.value),
              onKeyDown: saveOnEnter,
            }),
          ),
          h(
            "div",
            { className: "lares-skills-token-actions" },
            h(
              Button,
              {
                variant: "primary",
                size: "sm",
                disabled: saving || Boolean(busy),
                icon: saving ? h(IconLoadingOutlineMedium, { size: 14, className: "lares-skills-spin" }) : undefined,
                onClick: save,
              },
              t(saving ? "settings.tokenSaving" : "settings.tokenSave"),
            ),
          ),
        )
      : null,
  );
}

function PackCard({ id, status, busy, t, ...handlers }) {
  const pending = busy === id;
  const action = status ? packAction(status) : null;
  return h(
    "div",
    { className: "lares-skills-card" },
    h(
      "div",
      { className: "lares-skills-head" },
      h(
        "div",
        { className: "lares-skills-copy" },
        h("div", { className: "lares-skills-name" }, t(`pack.${id}.title`)),
        h("p", { className: "lares-skills-intro" }, t(`pack.${id}.intro`)),
      ),
      h(
        "div",
        { className: "lares-skills-actions" },
        // Only the control waits for the host: download / open / close depends on
        // state the browser cannot know, everything left of it is static.
        action
          ? h(
              Button,
              {
                variant: action.variant,
                size: "sm",
                disabled: Boolean(busy),
                icon: pending ? h(IconLoadingOutlineMedium, { size: 14, className: "lares-skills-spin" }) : undefined,
                onClick: handlers[action.handler],
              },
              t(pending ? action.pending : action.idle),
            )
          : h(IconLoadingOutlineMedium, {
              className: "lares-skills-spin",
              role: "status",
              "aria-label": t("settings.initializing"),
            }),
      ),
    ),
    CONFIGURABLE.has(id)
      ? h(TokenForm, { id, status, busy, t, onSave: handlers.onSaveToken })
      : null,
  );
}

export function SkillsSettings() {
  const t = useT();
  const [state, setState] = useState(rememberedSkillPacks);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const mounted = useMountedRef();
  const translate = useLatest(t);

  useEffect(() => {
    let alive = true;
    loadSkillPacks()
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

  const run = useCallback(
    async (id, action, errorKey = "settings.saveFailed") => {
      setBusy(id);
      setError("");
      try {
        const next = await action(id);
        if (mounted.current) setState(next);
        return true;
      } catch (err) {
        if (mounted.current) {
          setError(t(errorKey, { msg: err instanceof Error ? err.message : String(err) }));
        }
        return false;
      } finally {
        if (mounted.current) setBusy("");
      }
    },
    [mounted, t],
  );

  const status = new Map((state?.packs ?? []).map((pack) => [pack.id, pack]));

  return h(
    "div",
    { className: "lares-skills" },
    h(
      "section",
      { className: "lares-skills-group" },
      h("h3", { className: "lares-skills-group-title" }, t("settings.group.builtin")),
      PACK_IDS.map((id) =>
        h(PackCard, {
          key: id,
          id,
          status: status.get(id) ?? null,
          busy,
          t,
          onDownload: () => run(id, downloadSkillPack),
          onEnable: () => run(id, enableSkillPack),
          onDisable: () => run(id, disableSkillPack),
          onSaveToken: (server, token) => run(`${id}:token`, () => saveSkillConnection(id, server, token), "settings.tokenFailed"),
        }),
      ),
    ),
    error ? h("p", { className: "lares-settings-notice is-error" }, error) : null,
  );
}

function SkillsGlyph({ size = 16, className } = {}) {
  return h(
    "svg",
    { width: size, height: size, className, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
    h("rect", { x: 2.5, y: 2.5, width: 11, height: 11, rx: 2, stroke: "currentColor", strokeWidth: 1.4 }),
    h("path", { d: "M5 6.5h6M5 9.5h4", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" }),
  );
}

SkillsSettings.navIcon = SkillsGlyph;
