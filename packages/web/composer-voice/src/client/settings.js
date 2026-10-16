import { DICTATION_PRESETS, DICTATION_INSTRUCTIONS } from "@olares/lares-core/voice/dictation";
import { shortcutFromEvent, validateVoiceShortcuts } from "@olares/lares-core/voice/shortcuts";
import { VOICE_PRESETS } from "@olares/lares-core/voice/options";
import React from "react";
import { Button, Switch, Tag } from "@deepseek-ai/dsh-client-ui-primitives";
import {
  controlsCss,
  SettingsHeader,
  SettingsSelector,
} from "../../../shared/client/settings-controls.js";
import { watchCatalogRevision } from "../../../shared/client/catalog-events.js";
import { useLatest, useMountedRef } from "../../../shared/client/react-lifecycle.js";
import { installVoiceChart, loadVoiceSettings, rememberedVoiceSettings, saveVoiceSettings, voiceChartAction } from "./api.js";
import { GpuAppsCard, needsPlan, ReadingModeRow, SlicePlanCard, useGpuMode } from "./gpu-panel.js";
import {
  EMPTY_VOICE_CONFIG,
  selectedVoice,
  voiceLanguageItems,
  voiceMenuValue,
  voiceValueFromMenu,
} from "@olares/lares-core/voice/languages";
import { BluetoothDevices } from "./bluetooth.js";
import { MicGlyph } from "./icons.js";
import { useT } from "./locale.js";
import localSettingsCss from "./styles/settings.css";

const { useCallback, useEffect, useState } = React;
const h = React.createElement;

export const settingsCss = `${controlsCss}${localSettingsCss}`;

const PHASE_TONE = { running: "success", stopped: "neutral", busy: "info", failed: "danger", absent: "outline" };

function ModelTitle({ title, phase = "absent", t }) {
  return h(
    "span",
    { className: "lares-voice-model-title" },
    title,
    h(Tag, { tone: PHASE_TONE[phase] ?? "outline" }, t(`settings.phase.${phase}`)),
  );
}

function Notice({ notice }) {
  if (!notice) return null;
  return h("p", { className: `lares-settings-notice ${notice.kind === "error" ? "is-error" : ""}` }, notice.text);
}

function Group(title, notice, ...rows) {
  return h(
    "section",
    { className: "lares-voice-group" },
    h("div", { className: "lares-voice-group-title" }, title),
    h("div", { className: "lares-voice-card" }, ...rows),
    h(Notice, { notice }),
  );
}

const STT_FIELDS = new Set(["model", "language"]);

function patchScope(partial) {
  return Object.keys(partial).some((key) => STT_FIELDS.has(key)) ? "stt" : "tts";
}

function Row(title, hint, control) {
  return h(
    "div",
    { className: "lares-voice-row" },
    h(
      "div",
      { className: "lares-voice-row-text" },
      h("div", { className: "lares-voice-row-title" }, title),
      hint ? h("div", { className: "lares-voice-hint" }, hint) : null,
    ),
    control,
  );
}

export function VoiceSettings() {
  const t = useT();
  const [view, setView] = useState(rememberedVoiceSettings);
  const [dictationEditor, setDictationEditor] = useState("clean");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [installing, setInstalling] = useState(null);
  const [acting, setActing] = useState(null);
  const [notice, setNotice] = useState(null);
  const mounted = useMountedRef();
  const translate = useLatest(t);

  useEffect(() => {
    let alive = true;
    loadVoiceSettings()
      .then((next) => {
        if (alive) setView(next);
      })
      .catch(() => {
        if (alive && mounted.current) {
          setView((current) => current ?? {
            config: EMPTY_VOICE_CONFIG,
            status: { modelAvailable: false },
            sttModels: [],
            ttsModels: [],
          });
          setNotice({ scope: "page", kind: "error", text: translate.current("settings.loadFailed") });
        }
      });
    const stop = watchCatalogRevision(() => {
      if (alive) void loadVoiceSettings({ force: true }).then((next) => {
        if (alive) setView(next);
      }).catch(() => {});
    });
    return () => {
      alive = false;
      stop();
    };
  }, []);

  const gpu = useGpuMode(() => {
    void loadVoiceSettings({ force: true }).then((next) => {
      if (mounted.current) setView(next);
    }).catch(() => {});
  });
  const gpuRef = useLatest(gpu);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setNotice(null);
    try {
      const next = await loadVoiceSettings({ force: true });
      if (mounted.current) setView(next);
    } catch {
      if (mounted.current) setNotice({ scope: "page", kind: "error", text: translate.current("settings.refreshFailed") });
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, []);

  const patch = useCallback(async (partial) => {
    if (!view) return;
    const previous = view;
    setView({ ...view, config: { ...view.config, ...partial } });
    setSaving(true);
    setNotice(null);
    try {
      const next = await saveVoiceSettings(partial);
      if (mounted.current) setView(next);
    } catch {
      if (mounted.current) {
        setView(previous);
        setNotice({ scope: patchScope(partial), kind: "error", text: translate.current("settings.saveFailed") });
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, [view]);

  const install = useCallback(async (kind) => {
    setInstalling(kind);
    setNotice(null);
    try {
      const next = await installVoiceChart(kind);
      if (mounted.current) setView(next);
    } catch {
      if (mounted.current) setNotice({ scope: kind, kind: "error", text: translate.current("settings.installFailed") });
    } finally {
      if (mounted.current) setInstalling(null);
    }
  }, []);

  const act = useCallback(async (kind, op) => {
    setActing({ kind, op });
    setNotice(null);
    try {
      const next = await voiceChartAction(kind, op);
      if (!mounted.current) return;
      setView(next);
      if (op !== "probe") void gpuRef.current.reload().catch(() => {});
      if (op === "probe") setNotice({ scope: kind, kind: "info", text: translate.current("settings.probeOk") });
    } catch {
      if (!mounted.current) return;
      const key = op === "probe"
        ? "settings.probeFailed"
        : op === "stop"
          ? "settings.stopFailed"
          : "settings.resumeFailed";
      setNotice({ scope: kind, kind: "error", text: translate.current(key) });
    } finally {
      if (mounted.current) setActing(null);
    }
  }, []);

  useEffect(() => {
    const charts = view?.charts;
    if (!charts || (charts.stt?.phase !== "busy" && charts.tts?.phase !== "busy")) return undefined;
    const timer = setInterval(() => {
      loadVoiceSettings({ force: true }).then((next) => {
        if (mounted.current) setView(next);
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [view?.charts?.stt?.phase, view?.charts?.tts?.phase]);

  const pinned = React.useRef("");
  useEffect(() => {
    if (!view || saving) return;
    const sttIds = view.sttModels ?? [];
    const ttsIds = view.ttsModels ?? [];
    const partial = {};
    const nextStt = selectedVoice(view.config.model, sttIds);
    const nextTts = selectedVoice(view.config.ttsModel, ttsIds);
    if (sttIds.length && view.config.model !== nextStt) partial.model = nextStt;
    if (ttsIds.length && view.config.ttsModel !== nextTts) partial.ttsModel = nextTts;
    const key = JSON.stringify(partial);
    if (key === "{}" || pinned.current === key) return;
    pinned.current = key;
    void patch(partial);
  }, [view, patch, saving]);

  if (!view) {
    return h(
      "div",
      { className: "lares-voice" },
      h("div", { className: "lares-settings-notice" }, t("settings.loading")),
    );
  }

  const { config } = view;
  const busy = saving || refreshing || installing !== null || acting !== null;
  const scoped = (scope) => (notice?.scope === scope ? notice : null);

  // The GPU app list is read fresh on every load; the voice settings cache can lag behind it.
  function chartPhase(kind) {
    const chart = view.charts?.[kind];
    const app = chart?.app ? gpu.mode?.apps?.find((entry) => entry.app === chart.app) : null;
    if (app) return app.pending ? "busy" : app.phase;
    return chart?.phase ?? "absent";
  }

  function modelControl(kind) {
    const phase = chartPhase(kind);
    if (phase === "running" || phase === "stopped") {
      const probing = acting?.kind === kind && acting.op === "probe";
      const power = phase === "stopped" ? "resume" : "stop";
      const powering = acting?.kind === kind && acting.op === power;
      return [
        h(Button, {
          key: `${kind}-probe`,
          variant: "outline",
          size: "sm",
          disabled: busy,
          onClick: () => act(kind, "probe"),
        }, probing ? t("settings.probing") : t("settings.probe")),
        h(Button, {
          key: `${kind}-power`,
          variant: "outline",
          size: "sm",
          disabled: busy,
          onClick: () => act(kind, power),
        }, powering
          ? t(power === "resume" ? "settings.resuming" : "settings.stopping")
          : t(power === "resume" ? "settings.resume" : "settings.stop")),
      ];
    }
    return h(
      Button,
      {
        variant: "outline",
        size: "sm",
        disabled: busy || phase === "busy",
        onClick: () => install(kind),
      },
      installing === kind || phase === "busy" ? t("settings.installing") : t("settings.install"),
    );
  }

  return h(
    "div",
    { className: "lares-voice" },
    h(SettingsHeader, {
      title: t("settings.title"),
      refreshing,
      disabled: refreshing || saving,
      onRefresh: refresh,
      routerRoute: "audio",
      t,
    }),
    h(Notice, { notice: scoped("page") }),
    Group(t("dictation.settings"), scoped("tts"),
      Row(t("dictation.preset"), null, h(SettingsSelector, { value: config.dictationPreset, items: DICTATION_PRESETS.map((id) => ({ id, label: t(`dictation.${id}`) })), disabled: busy, onSelect: (dictationPreset) => patch({ dictationPreset }) })),
      Row(t("dictation.configure"), null, h(SettingsSelector, { value: dictationEditor, items: DICTATION_PRESETS.map((id) => ({ id, label: t(`dictation.${id}`) })), onSelect: setDictationEditor })),
      dictationEditor !== "raw" ? h(React.Fragment, null,
        Row(t("dictation.model"), null, h(SettingsSelector, { value: config.dictationProfiles[dictationEditor].model || "__none__", items: [{ id: "__none__", label: "—" }, ...(view.chatModels || []).map((id) => ({ id, label: id }))], disabled: busy,
          onSelect: (model) => patch({ dictationProfiles: { ...config.dictationProfiles, [dictationEditor]: { ...config.dictationProfiles[dictationEditor], model: model === "__none__" ? "" : model } } }) })),
        Row(t("dictation.instructions"), null, h("textarea", { key: `${dictationEditor}:${config.dictationProfiles[dictationEditor].instructions}`, defaultValue: config.dictationProfiles[dictationEditor].instructions, disabled: busy, maxLength: 8000,
          onBlur: (event) => { if (event.target.value !== config.dictationProfiles[dictationEditor].instructions) void patch({ dictationProfiles: { ...config.dictationProfiles, [dictationEditor]: { ...config.dictationProfiles[dictationEditor], instructions: event.target.value } } }); } })),
        h(Button, { disabled: busy, onClick: () => patch({ dictationProfiles: { ...config.dictationProfiles, [dictationEditor]: { ...config.dictationProfiles[dictationEditor], instructions: DICTATION_INSTRUCTIONS[dictationEditor] } } }) }, t("dictation.reset"))) : h("p", null, t("dictation.noLlm")),
      ...["default", ...DICTATION_PRESETS].map((id) => Row(t(id === "default" ? "dictation.shortcut" : `dictation.${id}`), t("dictation.shortcutHint"), h("input", { readOnly: true, value: config.dictationShortcuts[id] || "", "aria-label": `${t("dictation.shortcut")} ${id}`, disabled: busy,
        onKeyDown: (event) => { if (event.key === "Tab") return; event.preventDefault(); if (event.repeat) return; const key = ["Backspace", "Delete"].includes(event.key) ? "" : shortcutFromEvent(event); if (!key && !["Backspace", "Delete"].includes(event.key)) return;
          try { const dictationShortcuts = validateVoiceShortcuts({ ...config.dictationShortcuts, [id]: key }); void patch({ dictationShortcuts }); } catch { setNotice({ scope: "tts", kind: "error", text: t("dictation.shortcutConflict") }); } } }))),
    ),
    Group(t("settings.conversation"), null,

      Row(t("settings.preset"), null, h(SettingsSelector, { value: config.preset || "assistant", items: VOICE_PRESETS.map((id) => ({ id, label: t(`settings.preset.${id}`) })), onSelect: (preset) => patch({ preset }), disabled: busy })),
      Row(t("settings.chatModel"), null, h(SettingsSelector, { value: config.chatModel || "default-chat", disabled: busy, items: [...new Set(["default-chat", config.chatModel, ...(view.chatModels || [])].filter(Boolean))].map((id) => ({ id, label: id })), onSelect: (chatModel) => patch({ chatModel }) })),
      Row(t("settings.backend"), t("settings.realtime.hint"), h(SettingsSelector, { value: config.backend || "pipeline", items: [{ id: "pipeline", label: t("settings.backend.pipeline") }, ...((view.realtimeReady || []).includes(config.realtimeModel) ? [{ id: "realtime", label: "Realtime" }] : [])], onSelect: (backend) => patch({ backend }), disabled: busy })),
      (view.realtimeModels || []).length ? Row(t("settings.realtime.model"), null, h(SettingsSelector, { value: config.realtimeModel || "__none__", items: [{ id: "__none__", label: "—", disabled: true }, ...(view.realtimeModels || []).map((id) => ({ id, label: id }))], onSelect: (realtimeModel) => { if (realtimeModel !== "__none__") void patch({ realtimeModel }); }, disabled: busy })) : null,
      Row(t("settings.webMode"), null, h(SettingsSelector, { value: config.mode || "single", items: ["single", "continuous"].map((id) => ({ id, label: t(`settings.mode.${id}`) })), onSelect: (mode) => patch({ mode }), disabled: busy })),
      Row(t("settings.mobileMode"), null, h(SettingsSelector, { value: config.mobileMode || "continuous", items: ["single", "continuous"].map((id) => ({ id, label: t(`settings.mode.${id}`) })), onSelect: (mobileMode) => patch({ mobileMode }), disabled: busy })),
      Row(t("settings.device"), null, h(SettingsSelector, { value: config.device || "auto", items: ["auto", "device", "headset"].map((id) => ({ id, label: t(`settings.device.${id}`) })), onSelect: (device) => patch({ device }), disabled: busy })),
    ),
    Group(
      t("settings.group.stt"),
      scoped("stt"),
      Row(t("settings.model.title"), null, h(SettingsSelector, { value: config.model || "__auto__", items: [{ id: "__auto__", label: t("settings.model.auto") }, ...(view.sttModels || []).map((id) => ({ id, label: id }))], disabled: busy, onSelect: (model) => patch({ model: model === "__auto__" ? "" : model }) })),
      Row(
        t("settings.language.title"),
        t("settings.language.hint"),
        h(SettingsSelector, {
          value: voiceMenuValue(config.language),
          items: voiceLanguageItems(t("lang.auto")),
          disabled: busy,
          onSelect: (id) => patch({ language: voiceValueFromMenu(id) }),
        }),
      ),
      Row(
        h(ModelTitle, { title: t("settings.stt.model"), phase: chartPhase("stt"), t }),
        t("settings.stt.hint"),
        h("div", { className: "lares-voice-controls" }, modelControl("stt")),
      ),
    ),
    Group(
      t("settings.group.tts"),
      scoped("tts"),
      Row(
        t("settings.speak.title"),
        t("settings.tts.hint"),
        h(Switch, {
          checked: config.speak === true,
          disabled: busy,
          label: t("settings.speak.label"),
          onChange: (next) => patch({ speak: next }),
        }),
      ),
      Row(
        h(ModelTitle, { title: t("settings.tts.model"), phase: chartPhase("tts"), t }),
        null,
        h("div", { className: "lares-voice-controls" }, modelControl("tts")),
      ),
      h(ReadingModeRow, { gpu, disabled: busy, t }),
    ),
    gpu.mode?.streaming || gpu.mode?.gpu?.type === "MemorySlice" || needsPlan(gpu.mode)
      ? h(SlicePlanCard, { gpu, disabled: busy, t })
      : null,
    gpu.mode?.gpu?.type === "TimeSlice" && !gpu.switching
      ? h(GpuAppsCard, { gpu, disabled: busy, t })
      : null,
    Group(t("settings.group.bluetooth"), null, h(BluetoothDevices, { t })),
  );
}

/** Settings nav glyph, read off the component by the shell's row projection. */
VoiceSettings.navIcon = MicGlyph;
