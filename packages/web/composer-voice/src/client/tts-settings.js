import React from "react";
import { Button, Switch } from "@deepseek-ai/dsh-client-ui-primitives";
import { createTtsSettings } from "@olares/lares-core/voice/tts-settings";
import { previewTts } from "@olares/lares-core/voice/tts-preview";
import { loadReadingMode } from "@olares/lares-core/voice/client";
import { gpuProblemText } from "@olares/lares-core/voice/gpu-problem";
import { SettingsSelector } from "../../../shared/client/settings-controls.js";
const h = React.createElement;
const row = (title, control, hint) => h("div", { className: "lares-voice-row" }, h("div", { className: "lares-voice-row-text" }, h("div", { className: "lares-voice-row-title" }, title), hint ? h("div", { className: "lares-voice-hint" }, hint) : null), h("div", { className: "lares-setting-field" }, control));
export function TtsSettings({ preferences, view, t }) {
  const [controller] = React.useState(() => createTtsSettings({ preferences, preview: previewTts }));
  const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  React.useEffect(() => { void controller.load(); return () => controller.dispose(); }, [controller]);
  const config = view.value.config;
  const models = [...new Set([config.ttsModel, ...(view.value.ttsModels || [])].filter(Boolean))];
  const [reading, setReading] = React.useState(null);
  const [readingError, setReadingError] = React.useState("");
  React.useEffect(() => {
    let stop = false;
    void loadReadingMode().then((value) => { if (!stop) setReading(value); }).catch(() => { if (!stop) setReading({ streaming: false, allowed: false, gpu: null }); });
    return () => { stop = true; };
  }, []);
  const save = (operation) => { void operation.catch(() => {}); };
  const chooseReading = (on) => {
    if (on && !reading?.allowed) {
      setReadingError(reading?.problem ? gpuProblemText(t, reading.problem) : t("error.voice_streaming_time_slice"));
      return;
    }
    setReadingError("");
    void preferences.patch({ streaming: on === true }).then(() => setReading((current) => (current ? { ...current, streaming: on === true } : current))).catch((error) => {
      const code = error?.code || error?.reason;
      const text = code ? t(`error.${code}`) : "";
      setReadingError(text && text !== `error.${code}` ? text : t("settings.saveFailed"));
    });
  };
  const notice = key => h("p", { role: "alert", className: "lares-settings-notice is-error" }, t(key));
  const readingHint = reading?.gpu?.type
    ? (reading.allowed ? t("settings.mode.gpu", { type: t(`settings.gpu.${reading.gpu.type}`) }) : t("settings.mode.hint"))
    : reading?.problem ? gpuProblemText(t, reading.problem) : t("settings.mode.hint");
  return h("section", { className: "lares-voice-group" }, h("div", { className: "lares-voice-group-title" }, t("settings.tts.title")), h("div", { className: "lares-voice-card" },
    row(t("settings.tts.model"), h(SettingsSelector, { value: config.ttsModel || "__auto__", items: [{ id: "__auto__", label: t("settings.model.auto") }, ...models.map(id => ({ id, label: id }))], disabled: state.saving, onSelect: id => save(controller.selectModel(id === "__auto__" ? "" : id)) }), state.model ? null : t("preferences.modelsMissing")),
    view.errors.ttsModel ? notice("settings.saveFailed") : null,
    state.loading ? h("p", { role: "status" }, t("tts.loading")) : state.error ? h("div", { role: "alert" }, t("tts.loadFailed"), h(Button, { variant: "outline", size: "sm", className: "lares-settings-action", onClick: () => { void controller.load(); } }, t("dictation.retry"))) : state.model ? state.voices.length || state.unavailable ? row(t("tts.voice"), h(SettingsSelector, { value: state.selected || "__default__", items: [{ id: "__default__", label: t("tts.default") }, ...(state.unavailable ? [{ id: state.selected, label: `${state.selected} · ${t("preferences.unavailable")}`, disabled: true }] : []), ...state.voices], disabled: state.saving, onSelect: id => save(controller.selectVoice(id === "__default__" ? "" : id)) })) : h("p", { className: "lares-voice-hint" }, t("tts.noPresets")) : null,
    view.errors.ttsVoiceByModel ? notice("settings.saveFailed") : null,
    row(t("tts.preview"), h(Button, { variant: "outline", size: "sm", className: "lares-settings-action", disabled: !state.model || state.loading || Boolean(state.error) || state.saving || state.unavailable || state.blocked, onClick: () => { void controller.audition(); } }, t(state.playing ? "tts.stopPreview" : "tts.preview")), state.blocked ? t("tts.busy") : t("tts.previewHint")),
    state.previewError ? notice("tts.previewFailed") : null,
    row(t("settings.speak.title"), h(Switch, { checked: config.speak === true, disabled: Boolean(view.pending.speak), label: t("settings.speak.label"), onChange: speak => save(preferences.patch({ speak })) }), t("settings.tts.hint")),
    view.errors.speak ? notice("settings.saveFailed") : null,
    row(t("settings.mode.streaming"), h(Switch, { checked: config.streaming === true, disabled: Boolean(view.pending.streaming) || !reading, label: t("settings.mode.streaming"), onChange: chooseReading }), readingHint),
    readingError ? h("p", { role: "alert", className: "lares-settings-notice is-error" }, readingError) : null,
    view.errors.streaming ? notice("settings.saveFailed") : null));
}
