import React from "react";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import { SettingsSelector } from "../../../shared/client/settings-controls.js";
const h = React.createElement;

export function PresetEditor({ id, preferences, view, t, disabled = false }) {
  const labelId = React.useId();
  if (id === "raw") return h("p", { className: "lares-voice-hint" }, t("dictation.noLlm"));
  const profile = preferences.profile(id), key = `profile:${id}`;
  const pending = disabled || Boolean(view.pending[key]), dirty = preferences.dirty(id);
  const available = view.value.chatModels || [];
  const models = [...new Set([profile.model, ...(available.length ? ["default-chat"] : []), ...available].filter(Boolean))];
  return h("div", { className: "lares-preset-editor", "aria-label": t(`dictation.${id}`) },
    h("div", { className: "lares-voice-row" }, h("span", { className: "lares-voice-row-title" }, t("dictation.model")),
      h(SettingsSelector, { value: profile.model || "__none__", items: [{ id: "__none__", label: t("settings.model.none") }, ...models.map(id => { const ready = available.includes(id) || id === "default-chat" && available.length > 0; return { id, label: ready ? id : `${id} · ${t("preferences.unavailable")}`, disabled: !ready }; })], disabled: pending,
        onSelect: model => preferences.edit(id, { model: model === "__none__" ? "" : model }) })),
    !available.length ? h("p", { className: "lares-voice-hint" }, t("preferences.modelsMissing")) : null,
    h("label", { htmlFor: labelId, className: "lares-voice-row-title" }, t("dictation.instructions")),
    h("textarea", { id: labelId, rows: 6, className: "lares-preset-instructions", value: profile.instructions, disabled: pending, maxLength: 8000,
      onChange: event => preferences.edit(id, { instructions: event.target.value }) }),
    h("div", { className: "lares-preset-actions" },
      h(Button, { variant: "ghost", size: "sm", disabled: pending, onClick: () => preferences.restore(id) }, t("dictation.reset")),
      dirty ? h(React.Fragment, null,
        h(Button, { variant: "outline", size: "sm", disabled: pending, onClick: () => preferences.discard([id]) }, t("preferences.cancel")),
        h(Button, { variant: "primary", size: "sm", disabled: pending, onClick: () => { void preferences.saveProfile(id).catch(() => {}); } }, t(pending ? "preferences.saving" : "preferences.save"))) : null),
    view.errors[key] ? h("p", { role: "alert", className: "lares-settings-notice is-error" }, t("settings.saveFailed")) : null);
}
