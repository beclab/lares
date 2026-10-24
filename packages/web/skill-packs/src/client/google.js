import React from "react";
import { googleClientFile } from "@olares/lares-core/skills/client";
const h = React.createElement;
const { useState } = React;

export function GoogleConnection({ status, busy, t, onAction }) {
  const [email, setEmail] = useState("");
  const [callback, setCallback] = useState("");
  const [authorization, setAuthorization] = useState(null);
  const [fileError, setFileError] = useState("");
  const connection = status?.connection;
  if (!status?.downloaded) return h("p", { className: "lares-skills-hint" }, t("google.installFirst"));
  const button = (key, action, disabled = false) => h("button", { type: "button", disabled: Boolean(busy) || disabled, onClick: action }, t(key));
  const input = (label, value, set, type = "text") => h("label", { className: "lares-skills-field" }, h("span", null, t(label)), h("input", { type, value, disabled: Boolean(busy), autoComplete: "off", spellCheck: false, onChange: (event) => set(event.target.value) }));
  const importFile = async (event) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    setFileError("");
    try { const raw = await googleClientFile(file); if (await onAction("importGoogle", raw)) { setAuthorization(null); setCallback(""); } }
    catch (err) { setFileError(t("google.error", { msg: err.message })); }
  };
  const start = async () => {
    setCallback(""); setAuthorization(null);
    const result = await onAction("startGoogle", connection?.email || email);
    if (result) setAuthorization(result.authorization);
  };
  const complete = async () => {
    const value = callback; setCallback("");
    if (await onAction("completeGoogle", value)) setAuthorization(null);
  };
  const disconnect = async () => {
    if (await onAction("disconnectGoogle")) { setAuthorization(null); setCallback(""); setEmail(""); }
  };
  return h("div", { className: "lares-skills-google" },
    h("p", { role: "status" }, t(`google.status.${connection?.status || "unconfigured"}`, { email: connection?.email || "" })),
    !connection?.email ? h("div", null,
      h("p", { className: "lares-skills-hint" }, t("google.setup")),
      h("p", null, h("a", { href: "https://console.cloud.google.com/auth/clients", target: "_blank", rel: "noopener noreferrer" }, t("google.console")), " · ", h("a", { href: "https://gogcli.sh/quickstart.html", target: "_blank", rel: "noopener noreferrer" }, t("google.docs"))),
      h("label", { className: "lares-skills-field" }, h("span", null, t("google.import")), h("input", { type: "file", accept: ".json,application/json", disabled: Boolean(busy), onChange: importFile })),
      connection?.configured ? h("p", { className: "lares-skills-hint" }, t("google.configured")) : null,
    ) : null,
    connection?.configured ? h("div", null,
      !connection.email ? input("google.email", email, setEmail, "email") : null,
      h("p", { className: "lares-skills-hint" }, t("google.permissions")),
      h("div", { className: "lares-skills-google-actions" },
        button(connection.email ? "google.reconnect" : "google.connect", start, !(connection.email || email.trim())),
        connection.email ? button("google.check", () => onAction("checkGoogle")) : null,
        connection.email ? button("google.disconnect", disconnect) : null),
      connection.email ? h("p", { className: "lares-skills-hint" }, t("google.disconnectHint")) : null,
    ) : null,
    authorization ? h("div", null,
      h("a", { href: authorization.url, target: "_blank", rel: "noopener noreferrer", referrerPolicy: "no-referrer" }, t("google.open")),
      h("p", { className: "lares-skills-hint" }, t("google.returnHint")),
      input("google.callback", callback, setCallback),
      button("google.complete", complete, !callback.trim()),
    ) : null,
    fileError ? h("p", { role: "alert" }, fileError) : null,
  );
}
