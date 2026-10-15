import React from "react";
import { Button, Input, SegmentedControl, StateDot, Switch, Tag } from "@deepseek-ai/dsh-client-ui-primitives";
import { useMountedRef } from "../../../shared/client/react-lifecycle.js";
import { loadGpuMode, postGpuApp, saveSlicePlan, switchGpuMode } from "./api.js";

const { useCallback, useEffect, useMemo, useState } = React;
const h = React.createElement;

const GIB = 2 ** 30;
const SWATCHES = 4;

function gib(bytes) {
  return Math.round((bytes / GIB) * 10) / 10;
}

function busyJob(mode) {
  const phase = mode?.job?.phase;
  return phase === "switching" || phase === "resuming";
}

function busyApps(mode) {
  return (mode?.apps ?? []).some((app) => app.pending);
}

/** Reading mode, the GPU slicing it needs, and the switch job; shared by both panels. */
export function useGpuMode(onSettled) {
  const [mode, setMode] = useState(null);
  const [error, setError] = useState("");
  const mounted = useMountedRef();
  const switching = busyJob(mode);
  const working = switching || busyApps(mode);

  const reload = useCallback(async () => {
    const next = await loadGpuMode();
    if (mounted.current) setMode(next);
    return next;
  }, []);

  useEffect(() => {
    reload().catch(() => {});
  }, []);

  useEffect(() => {
    if (!working) return undefined;
    const timer = setInterval(() => {
      reload().then((next) => {
        if (!busyJob(next) && !busyApps(next)) onSettled?.();
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [working]);

  const run = useCallback(async (request) => {
    setError("");
    try {
      const next = await request();
      if (mounted.current) setMode(next);
      onSettled?.();
      return true;
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, []);

  return {
    mode,
    error,
    switching,
    switchMode: (streaming) => run(() => switchGpuMode(streaming)),
    savePlan: (apps) => run(() => saveSlicePlan(apps)),
    appAction: (app, op) => run(() => postGpuApp(app, op)),
    reload,
  };
}

function modeStatus(gpu, t) {
  const { mode, error, switching } = gpu;
  const job = mode?.job;
  if (error) return { state: "error", text: t("settings.mode.failed", { error }) };
  if (switching) {
    const current = job.apps.find((app) => !app.ok && !app.message)?.app;
    return {
      state: "ongoing",
      text: current ? t("settings.mode.resumingApp", { app: current }) : t("settings.mode.switching"),
    };
  }
  if (job?.phase === "failed") return { state: "error", text: t("settings.mode.failed", { error: job.error }) };
  if (job?.phase === "partial") {
    const apps = job.apps.filter((app) => !app.ok).map((app) => app.app).join("、");
    return { state: "warning", text: t("settings.mode.partial", { apps }) };
  }
  if (!mode?.gpu) return mode ? { state: "warning", text: t("settings.mode.noGpu") } : null;
  const type = t(`settings.gpu.${mode.gpu.type}`);
  return mode.gpu.type === mode.target
    ? { state: "done", text: t("settings.mode.gpu", { type }) }
    : { state: "warning", text: t("settings.mode.mismatch", { type }) };
}

/** 播报方式：写完再读 (TimeSlice) / 边写边读 (MemorySlice). */
export function ReadingModeRow({ gpu, disabled, t }) {
  const { mode, switching } = gpu;
  const status = modeStatus(gpu, t);
  const failed = mode?.job?.phase === "failed" || mode?.job?.phase === "partial";
  return h(
    "div",
    { className: "lares-voice-row lares-voice-mode" },
    h(
      "div",
      { className: "lares-voice-row-text" },
      h("div", { className: "lares-voice-row-title" }, t("settings.mode.title")),
      h("div", { className: "lares-voice-hint" }, t("settings.mode.hint")),
      status
        ? h(
          "div",
          { className: `lares-voice-status is-${status.state}` },
          h(StateDot, { state: status.state }),
          h("span", null, status.text),
        )
        : null,
    ),
    h(
      "div",
      { className: "lares-voice-controls" },
      failed
        ? h(Button, {
          variant: "ghost",
          size: "sm",
          disabled: disabled || switching,
          onClick: () => gpu.switchMode(mode.streaming),
        }, t("settings.mode.retry"))
        : null,
      h(SegmentedControl, {
        id: "lares-voice-mode",
        label: t("settings.mode.title"),
        value: mode?.streaming ? "streaming" : "turns",
        disabled: disabled || switching || !mode,
        options: [
          { value: "turns", label: t("settings.mode.turns") },
          { value: "streaming", label: t("settings.mode.streaming") },
        ],
        onChange: (next) => gpu.switchMode(next === "streaming"),
      }),
    ),
  );
}

function draftOf(plan) {
  return Object.fromEntries((plan ?? []).map((entry) => [
    entry.app,
    { enabled: entry.enabled, size: entry.memory > 0 ? String(gib(entry.memory)) : "" },
  ]));
}

function appLabel(entry, t) {
  if (entry.kind === "stt") return t("settings.stt.title");
  if (entry.kind === "tts") return t("settings.tts.title");
  return entry.title || entry.app;
}

function jobState(mode, app) {
  const entry = mode?.job?.apps.find((item) => item.app === app);
  if (!entry) return busyJob(mode) ? { state: "idle", text: "" } : null;
  if (entry.ok) return { state: "done", text: "" };
  if (entry.message) return { state: "error", text: entry.message };
  return { state: "ongoing", text: "" };
}

/** Which apps stay on the memory-sliced card and how much each gets. */
export function SlicePlanCard({ gpu, disabled, t }) {
  const { mode, switching } = gpu;
  const [draft, setDraft] = useState(() => draftOf(mode?.plan));
  const [saving, setSaving] = useState(false);
  const saved = useMemo(() => draftOf(mode?.plan), [mode?.plan]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  useEffect(() => {
    if (!dirty || switching) setDraft(saved);
  }, [saved]);

  const plan = mode?.plan ?? [];
  const total = mode?.gpu?.memory ?? 0;
  const rows = plan.map((entry, index) => {
    const value = draft[entry.app] ?? { enabled: false, size: "" };
    const size = Number(value.size);
    const floor = Math.max(0.25, entry.required ? entry.required / GIB : 0);
    const valid = Number.isFinite(size) && size >= floor;
    return { entry, value, index, bytes: value.enabled && valid ? size * GIB : 0, valid };
  });
  const used = rows.reduce((sum, row) => sum + row.bytes, 0);
  const over = total > 0 && used > total;
  const invalid = rows.some((row) => row.value.enabled && !row.valid);
  const live = mode?.gpu?.type === "MemorySlice";
  const locked = disabled || switching || saving;

  const edit = (app, patch) => setDraft((current) => ({ ...current, [app]: { ...current[app], ...patch } }));
  const save = async () => {
    setSaving(true);
    await gpu.savePlan(rows.map((row) => ({
      app: row.entry.app,
      enabled: row.value.enabled,
      memory: row.valid ? Math.round(Number(row.value.size) * GIB) : 0,
    })));
    setSaving(false);
  };

  return h(
    "section",
    { className: "lares-voice-group" },
    h("div", { className: "lares-voice-group-title" }, t("settings.slices.title")),
    h(
      "div",
      { className: "lares-voice-card lares-voice-slices" },
      h(
        "div",
        { className: "lares-voice-slices-head" },
        h("div", { className: "lares-voice-row-title" }, mode?.gpu?.model || t("settings.slices.gpu")),
        h(Tag, { tone: over ? "danger" : "neutral" }, t("settings.slices.used", { used: gib(used), total: gib(total) })),
      ),
      h(
        "div",
        { className: `lares-voice-meter${over ? " is-over" : ""}`, role: "img", "aria-label": t("settings.slices.used", { used: gib(used), total: gib(total) }) },
        rows.filter((row) => row.bytes > 0).map((row) => h("span", {
          key: row.entry.app,
          className: `lares-voice-meter-part is-swatch-${row.index % SWATCHES}`,
          style: { flexGrow: row.bytes },
          title: `${appLabel(row.entry, t)} · ${gib(row.bytes)} GiB`,
        })),
        total > used ? h("span", { className: "lares-voice-meter-free", style: { flexGrow: total - used } }) : null,
      ),
      h("div", { className: "lares-voice-hint" }, live ? t("settings.slices.hint") : t("settings.slices.hintPending")),
      plan.length
        ? h(
          "ul",
          { className: "lares-voice-slice-list" },
          rows.map((row) => {
            const state = jobState(mode, row.entry.app);
            return h(
              "li",
              { key: row.entry.app, className: `lares-voice-slice${row.value.enabled ? "" : " is-off"}` },
              h("span", { className: `lares-voice-swatch is-swatch-${row.index % SWATCHES}`, "aria-hidden": true }),
              h(
                "div",
                { className: "lares-voice-slice-name" },
                h("div", { className: "lares-voice-row-title" }, appLabel(row.entry, t)),
                h("div", { className: "lares-voice-hint", title: row.entry.app }, [
                  row.entry.kind ? row.entry.title : "",
                  row.entry.required ? t("settings.apps.required", { size: gib(row.entry.required) }) : "",
                ].filter(Boolean).join(" · ") || row.entry.app),
                state?.text ? h("div", { className: "lares-voice-hint is-error" }, state.text) : null,
              ),
              state ? h(StateDot, { state: state.state }) : null,
              h(
                "label",
                { className: `lares-voice-size${row.value.enabled && !row.valid ? " is-invalid" : ""}` },
                h(Input, {
                  type: "number",
                  min: 0.25,
                  step: 0.5,
                  inputMode: "decimal",
                  value: row.value.size,
                  disabled: locked || !row.value.enabled,
                  "aria-label": t("settings.slices.size", { app: appLabel(row.entry, t) }),
                  onChange: (event) => edit(row.entry.app, { size: event.target.value }),
                }),
                h("span", { className: "lares-voice-size-unit" }, "GiB"),
              ),
              h(Switch, {
                checked: row.value.enabled,
                disabled: locked,
                label: t("settings.slices.enable", { app: appLabel(row.entry, t) }),
                onChange: (enabled) => edit(row.entry.app, enabled && !row.value.size && row.entry.required
                  ? { enabled, size: String(gib(row.entry.required)) }
                  : { enabled }),
              }),
            );
          }),
        )
        : h("div", { className: "lares-voice-hint" }, t("settings.slices.empty")),
      h(
        "div",
        { className: "lares-voice-slices-foot" },
        h(
          "span",
          { className: `lares-voice-hint${over || invalid ? " is-error" : ""}` },
          over
            ? t("settings.slices.over", { over: gib(used - total) })
            : invalid
              ? t("settings.slices.invalid")
              : dirty && live
                ? t("settings.slices.restart")
                : "",
        ),
        h(Button, {
          variant: "ghost",
          size: "sm",
          disabled: locked || !dirty,
          onClick: () => setDraft(saved),
        }, t("settings.slices.reset")),
        h(Button, {
          variant: "primary",
          size: "sm",
          disabled: locked || !dirty || over || invalid,
          onClick: save,
        }, saving ? t("settings.slices.saving") : live ? t("settings.slices.apply") : t("settings.slices.save")),
      ),
    ),
  );
}

const PHASE_DOT = { running: "done", stopped: "idle", busy: "ongoing", failed: "error", absent: "idle" };

/** Time slicing: every GPU app shares the whole card, started and stopped here. */
export function GpuAppsCard({ gpu, disabled, t }) {
  const { mode, switching } = gpu;
  const apps = mode?.apps ?? [];
  return h(
    "section",
    { className: "lares-voice-group" },
    h("div", { className: "lares-voice-group-title" }, t("settings.apps.title")),
    h(
      "div",
      { className: "lares-voice-card lares-voice-slices" },
      h("div", { className: "lares-voice-hint" }, t("settings.apps.hint")),
      apps.length
        ? h(
          "ul",
          { className: "lares-voice-slice-list" },
          apps.map((app) => {
            const running = app.phase === "running";
            const op = running ? "stop" : "resume";
            const state = app.pending ? "ongoing" : app.error ? "error" : PHASE_DOT[app.phase] ?? "idle";
            const label = app.pending
              ? t(app.pending === "stop" ? "settings.apps.stopping" : "settings.apps.starting")
              : t(running ? "settings.apps.stop" : "settings.apps.start");
            return h(
              "li",
              { key: app.app, className: "lares-voice-slice" },
              h(StateDot, { state }),
              h(
                "div",
                { className: "lares-voice-slice-name" },
                h("div", { className: "lares-voice-row-title" }, app.title),
                h("div", { className: "lares-voice-hint", title: app.app }, [
                  app.app,
                  app.required ? t("settings.apps.required", { size: gib(app.required) }) : "",
                ].filter(Boolean).join(" · ")),
                app.error ? h("div", { className: "lares-voice-hint is-error" }, app.error) : null,
              ),
              h(Tag, { tone: running ? "success" : "neutral" }, t(`settings.phase.${app.phase}`)),
              h(Button, {
                variant: running ? "outline" : "primary",
                size: "sm",
                disabled: disabled || switching || Boolean(app.pending) || app.phase === "busy",
                onClick: () => gpu.appAction(app.app, op),
              }, label),
            );
          }),
        )
        : h("div", { className: "lares-voice-hint" }, mode ? t("settings.apps.empty") : t("settings.loading")),
    ),
  );
}
