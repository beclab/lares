import React from "react";
import { Button, IconLoadingOutline16 } from "@deepseek-ai/dsh-client-ui-primitives";
import { OFFICIAL_PACKS } from "@olares/lares-core/skills/packs";
import { controlsCss } from "../../../shared/client/settings-controls.js";
import { useLatest, useMountedRef } from "../../../shared/client/react-lifecycle.js";
import {
  disableSkillPack,
  downloadSkillPack,
  enableSkillPack,
  loadSkillPacks,
  rememberedSkillPacks,
} from "./api.js";
import { useT } from "./locale.js";
import localSettingsCss from "./styles/settings.css";

const { useCallback, useEffect, useState } = React;
const h = React.createElement;

export const settingsCss = `${controlsCss}${localSettingsCss}`;

/** Which packs exist is a build-time fact, so the cards never wait on the host. */
const PACK_IDS = OFFICIAL_PACKS.map((pack) => pack.id);

function packAction(status) {
  if (!status.downloaded) {
    return { variant: "primary", idle: "settings.download", pending: "settings.downloading", handler: "onDownload" };
  }
  return status.enabled
    ? { variant: "outline", idle: "settings.disable", pending: "settings.disabling", handler: "onDisable" }
    : { variant: "primary", idle: "settings.enable", pending: "settings.enabling", handler: "onEnable" };
}

function PackCard({ id, status, busy, t, ...handlers }) {
  const pending = busy === id;
  const action = status ? packAction(status) : null;
  return h(
    "div",
    { className: "lares-skills-card" },
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
              icon: pending ? h(IconLoadingOutline16, { size: 14, className: "lares-skills-spin" }) : undefined,
              onClick: handlers[action.handler],
            },
            t(pending ? action.pending : action.idle),
          )
        : h(IconLoadingOutline16, {
            className: "lares-skills-spin",
            role: "status",
            "aria-label": t("settings.initializing"),
          }),
    ),
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
    async (id, action) => {
      setBusy(id);
      setError("");
      try {
        const next = await action(id);
        if (mounted.current) setState(next);
      } catch (err) {
        if (mounted.current) {
          setError(t("settings.saveFailed", { msg: err instanceof Error ? err.message : String(err) }));
        }
      } finally {
        if (mounted.current) setBusy("");
      }
    },
    [t],
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
