import React from "react";
import { Button, Modal } from "@deepseek-ai/dsh-client-ui-primitives";
const h = React.createElement;

export function usePreferencesLeave(preferences, bindBeforeLeave, t) {
  const [question, setQuestion] = React.useState(null), [saving, setSaving] = React.useState(false), [error, setError] = React.useState(false);
  const pending = React.useRef(null);
  const request = React.useCallback(() => {
    if (!preferences.dirtyIds().length) return Promise.resolve(true);
    if (pending.current) return pending.current.promise;
    let resolve; const promise = new Promise(done => { resolve = done; });
    pending.current = { promise, resolve }; setQuestion(true); setError(false); return promise;
  }, [preferences]);
  const answer = value => { pending.current?.resolve(value); pending.current = null; setQuestion(null); };
  React.useEffect(() => bindBeforeLeave?.(request), [bindBeforeLeave, request]);
  React.useEffect(() => {
    const warn = event => { if (preferences.dirtyIds().length) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); pending.current?.resolve(false); pending.current = null; };
  }, [preferences]);
  const modal = h(Modal, { open: Boolean(question), title: t("preferences.unsaved"), closeLabel: t("preferences.continue"), onClose: () => { if (!saving) answer(false); },
    description: t("preferences.unsavedHint"), footer: h(React.Fragment, null,
      h(Button, { variant: "outline", disabled: saving, onClick: () => answer(false) }, t("preferences.continue")),
      h(Button, { variant: "outline", disabled: saving, onClick: () => { preferences.discard(); answer(true); } }, t("preferences.discard")),
      h(Button, { variant: "primary", disabled: saving, onClick: async () => { setSaving(true); setError(false); try { await preferences.saveDirty(); answer(true); } catch { setError(true); } finally { setSaving(false); } } }, t(saving ? "preferences.saving" : "preferences.save"))) },
    error ? h("p", { role: "alert", className: "lares-settings-notice is-error" }, t("settings.saveFailed")) : null);
  return { request, modal };
}
