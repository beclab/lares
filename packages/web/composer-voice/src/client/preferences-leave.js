import React from "react";
import { Button, Modal } from "@deepseek-ai/dsh-client-ui-primitives";
import { createPreferencesGuard } from "@olares/lares-core/voice/preferences";
const h = React.createElement;

export function usePreferencesLeave(preferences, bindBeforeLeave, t) {
  const [guard] = React.useState(() => createPreferencesGuard(preferences));
  const view = React.useSyncExternalStore(guard.subscribe, guard.getSnapshot);
  const request = React.useCallback(() => guard.request(), [guard]);
  React.useEffect(() => bindBeforeLeave?.(request), [bindBeforeLeave, request]);
  React.useEffect(() => {
    const warn = event => { if (preferences.dirtyIds().length) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); guard.dispose(); };
  }, [preferences, guard]);
  const modal = h(Modal, { open: view.open, title: t("preferences.unsaved"), closeLabel: t("preferences.continue"), onClose: () => { void guard.answer("continue"); },
    description: t("preferences.unsavedHint"), footer: h(React.Fragment, null,
      h(Button, { variant: "outline", disabled: view.saving, onClick: () => { void guard.answer("continue"); } }, t("preferences.continue")),
      h(Button, { variant: "outline", disabled: view.saving, onClick: () => { void guard.answer("discard"); } }, t("preferences.discard")),
      h(Button, { variant: "primary", disabled: view.saving, onClick: () => { void guard.answer("save"); } }, t(view.saving ? "preferences.saving" : "preferences.save"))) },
    view.error ? h("p", { role: "alert", className: "lares-settings-notice is-error" }, t("settings.saveFailed")) : null);
  return { request, modal, selecting: view.selecting, selectPreset: id => guard.selectPreset(id) };
}
