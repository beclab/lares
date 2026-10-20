import React from "react";
import { Button, Modal } from "@deepseek-ai/dsh-client-ui-primitives";
import { messageFromCode } from "@olares/lares-core/i18n/t";
import { createVoiceKeysClient, VOICE_KEY_AGENT_MODELS, VOICE_KEY_DEFAULT_MODELS, VOICE_KEY_MODELS } from "@olares/lares-core/voice/keys-client";
import { useMountedRef } from "../../../shared/client/react-lifecycle.js";

const { useCallback, useEffect, useState } = React;
const h = React.createElement;

/** Owner-issued keys for server-side `lares-realtime-v1` callers such as Router. */
export function VoiceKeys({ t, client: injected }) {
  const [client] = useState(() => injected || createVoiceKeysClient());
  const [keys, setKeys] = useState(null);
  const [name, setName] = useState("");
  const [models, setModels] = useState(() => [...VOICE_KEY_DEFAULT_MODELS]);
  const [issued, setIssued] = useState(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useMountedRef();
  const failed = (err) => { if (mounted.current) setError(messageFromCode(t, err?.message || "", "error.voice_key_failed")); };

  const load = useCallback(async () => {
    try { const next = await client.list(); if (mounted.current) setKeys(next); }
    catch (err) { failed(err); }
  }, [client, mounted]);
  useEffect(() => { void load(); }, [load]);

  const toggle = (model) => setModels((current) => current.includes(model) ? current.filter((value) => value !== model) : VOICE_KEY_MODELS.filter((value) => value === model || current.includes(value)));
  const issue = async () => {
    setBusy(true); setError("");
    try {
      const record = await client.issue({ name, models });
      if (!mounted.current) return;
      setIssued(record); setCopied(false); setName(""); setModels([...VOICE_KEY_DEFAULT_MODELS]);
      await load();
    } catch (err) { failed(err); }
    finally { if (mounted.current) setBusy(false); }
  };
  const revoke = async () => {
    const target = revoking;
    setBusy(true); setError("");
    try { await client.revoke(target.id); if (mounted.current) setRevoking(null); await load(); }
    catch (err) { failed(err); }
    finally { if (mounted.current) setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(issued.key); if (mounted.current) setCopied(true); } catch { failed(new Error("voice_key_failed")); }
  };

  return h("div", { className: "lares-voice-row lares-voice-keys" },
    h("div", { className: "lares-voice-row-text" },
      h("div", { className: "lares-voice-row-title" }, t("settings.group.keys")),
      h("div", { className: "lares-voice-hint" }, t("settings.keys.hint"))),
    keys?.length
      ? h("ul", { className: "lares-voice-devices" }, keys.map((key) => h("li", { key: key.id, className: "lares-voice-device" },
        h("div", { className: "lares-voice-device-name" }, key.name,
          h("div", { className: "lares-voice-device-address" }, `${key.models.join(", ")} · ${t("settings.keys.created", { at: new Date(key.createdAt).toLocaleString() })}`)),
        h(Button, { variant: "outline", size: "sm", disabled: busy, onClick: () => setRevoking(key) }, t("settings.keys.revoke")))))
      : keys ? h("p", { className: "lares-voice-hint" }, t("settings.keys.empty")) : null,
    h("div", { className: "lares-voice-key-form" },
      h("label", { className: "lares-voice-key-field" }, h("span", null, t("settings.keys.name")),
        h("input", { type: "text", value: name, maxLength: 64, placeholder: t("settings.keys.namePlaceholder"), disabled: busy, onChange: (event) => setName(event.target.value) })),
      h("fieldset", { className: "lares-voice-key-models", disabled: busy }, h("legend", null, t("settings.keys.models")),
        VOICE_KEY_MODELS.map((model) => h("label", { key: model }, h("input", { type: "checkbox", checked: models.includes(model), onChange: () => toggle(model) }), model))),
      models.some((model) => VOICE_KEY_AGENT_MODELS.includes(model)) ? h("p", { role: "note", className: "lares-settings-notice is-error" }, t("settings.keys.agentWarning")) : null,
      h(Button, { variant: "primary", size: "sm", disabled: busy || !name.trim() || !models.length, onClick: () => { void issue(); } }, t(busy ? "settings.keys.issuing" : "settings.keys.issue"))),
    error ? h("p", { role: "alert", className: "lares-settings-notice is-error" }, error) : null,
    h(Modal, { open: Boolean(issued), title: t("settings.keys.issued"), closeLabel: t("settings.keys.done"), onClose: () => setIssued(null),
      footer: h(React.Fragment, null,
        h(Button, { variant: "outline", onClick: () => { void copy(); } }, t(copied ? "settings.keys.copied" : "settings.keys.copy")),
        h(Button, { variant: "primary", onClick: () => setIssued(null) }, t("settings.keys.done"))) },
      issued ? h("code", { className: "lares-voice-key-secret" }, issued.key) : null),
    h(Modal, { open: Boolean(revoking), title: t("settings.keys.revoke"), closeLabel: t("settings.keys.done"), onClose: () => setRevoking(null),
      description: revoking ? t("settings.keys.revokeConfirm", { name: revoking.name }) : "",
      footer: h(Button, { variant: "primary", disabled: busy, onClick: () => { void revoke(); } }, t("settings.keys.revoke")) }));
}
