import React from "react";
import { Button, Input, SegmentedControl, StateDot, Switch, Tag } from "@deepseek-ai/dsh-client-ui-primitives";
import { gpuProblemText } from "@olares/lares-core/voice/gpu-problem";
import { useMountedRef } from "../../../shared/client/react-lifecycle.js";
import { loadGpuMode, postGpuApp, saveSlicePlan, switchGpuMode } from "./api.js";

const { useCallback, useEffect, useMemo, useState } = React;
const h = React.createElement;

const GIB = 2 ** 30;
const SWATCHES = 4;
const BUSY = new Set(["switching", "restoring", "resuming"]);
const PLAN_PROBLEMS = new Set(["voice_gpu_plan_empty", "voice_gpu_plan_over", "voice_gpu_memory"]);

function gib(bytes) {
  return Math.round((bytes / GIB) * 10) / 10;
}

function busyJob(mode) {
  return BUSY.has(mode?.job?.phase);
}

/** The last switch failed on something the slice plan fixes, so the plan card shows beside it. */
export function needsPlan(mode) {
  const job = mode?.job;
  if (!job || !mode?.gpu?.available?.includes("MemorySlice")) return false;
  return PLAN_PROBLEMS.has(job.problem?.code) || job.apps.some((app) => PLAN_PROBLEMS.has(app.problem?.code));
}

function appName(mode, app, t) {
  const entry = mode?.plan?.find((item) => item.app === app) ?? mode?.apps?.find((item) => item.app === app);
  return entry ? appLabel(entry, t) : app;
}

function appNames(mode, apps, t) {
  return apps.map((app) => appName(mode, app, t)).join(t("settings.list.separator"));
}

/** A Host problem in the product language, with app ids shown as their names. */
export function problemText(mode, problem, t) {
  if (!problem) return "";
  const params = { ...problem.params };
  if (typeof params.app === "string") params.app = appName(mode, params.app, t);
  if (Array.isArray(params.apps)) params.apps = appNames(mode, params.apps, t);
  return gpuProblemText(t, { ...problem, params });
}

function requestProblem(err) {
  return {
    code: typeof err?.code === "string" ? err.code : "voice_gpu_failed",
    params: err?.params ?? {},
    detail: err instanceof Error ? err.message : String(err),
  };
}

function busyApps(mode) {
  return (mode?.apps ?? []).some((app) => app.pending);
}

/** Reading mode, the GPU slicing it needs, and the switch job; shared by both panels. */
export function useGpuMode(onSettled) {
  const [mode, setMode] = useState(null);
  const [error, setError] = useState(null);
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
    setError(null);
    try {
      const next = await request();
      if (mounted.current) setMode(next);
      onSettled?.();
      return true;
    } catch (err) {
      if (mounted.current) setError(requestProblem(err));
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

function restoreText(mode, job, t) {
  const lost = job.restored.filter((app) => !app.ok).map((app) => app.app);
  if (lost.length) return t("settings.mode.notRestored", { apps: appNames(mode, lost, t) });
  return job.restored.length ? t("settings.mode.restored") : "";
}

function modeStatus(gpu, t) {
  const { mode, error, switching } = gpu;
  const job = mode?.job;
  if (error) return { state: "error", text: problemText(mode, error, t) };
  if (switching) {
    if (job.phase === "restoring") return { state: "ongoing", text: t("settings.mode.restoring") };
    const current = job.apps.find((app) => !app.ok && !app.problem)?.app;
    return {
      state: "ongoing",
      text: current ? t("settings.mode.resumingApp", { app: appName(mode, current, t) }) : t("settings.mode.switching"),
    };
  }
  if (job?.phase === "failed") {
    return { state: "error", text: [problemText(mode, job.problem, t), restoreText(mode, job, t)].filter(Boolean).join(" ") };
  }
  if (job?.phase === "partial") {
    const problems = job.apps.filter((app) => app.problem).map((app) => problemText(mode, app.problem, t));
    return { state: "warning", text: [t("settings.mode.partial"), ...problems].join(" ") };
  }
  if (mode?.problem) return { state: "error", text: problemText(mode, mode.problem, t) };
  if (!mode?.gpu) return mode ? { state: "warning", text: t("error.voice_gpu_no_gpu") } : null;
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
  const target = failed || switching ? mode.job.target === "MemorySlice" : mode?.streaming;
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
          onClick: () => gpu.switchMode(target),
        }, t("settings.mode.retry"))
        : null,
      h(SegmentedControl, {
        id: "lares-voice-mode",
        label: t("settings.mode.title"),
        value: (switching ? target : mode?.streaming) ? "streaming" : "turns",
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

function jobState(mode, app, t) {
  const entry = mode?.job?.apps.find((item) => item.app === app);
  if (!entry) return busyJob(mode) ? { state: "idle", text: "" } : null;
  if (entry.ok) return { state: "done", text: "" };
  if (entry.problem) return { state: "error", text: problemText(mode, entry.problem, t) };
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
            const state = jobState(mode, row.entry.app, t);
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
            const state = app.pending ? "ongoing" : app.problem ? "error" : PHASE_DOT[app.phase] ?? "idle";
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
                app.problem ? h("div", { className: "lares-voice-hint is-error" }, problemText(mode, app.problem, t)) : null,
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
