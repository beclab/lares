import { readJsonFile, writeJsonFile } from "../tools/json-file.js";
import { dshPluginConfigPath } from "../workspace/home.js";
import { VoiceError } from "../router/stt.js";
import { readConfig, writeConfig } from "./config.js";
import { chartPhase, currentChartRow, runOlaresCli, VOICE_CHARTS } from "./install.js";

/**
 * Reading answers while they are written needs the LLM and speech models on
 * the GPU at once, so the card is cut into memory slices. Reading finished
 * answers lets the card time-slice instead, and each model gets the whole
 * card while it runs.
 */
export function gpuTypeFor(streaming) {
  return streaming ? "MemorySlice" : "TimeSlice";
}

const MIB = 2 ** 20;
// `market get` prints the whole catalog entry, tens of kilobytes with locales.
const MANIFEST_LIMIT = 1_000_000;

function planPath() {
  return dshPluginConfigPath("voice-gpu");
}

/**
 * Switching the type drops the card's bindings, so the apps that use the card
 * are kept here to resume them, also after a failed switch.
 * `apps`: every app seen bound to the card; `slices`: app → bytes it gets
 * while memory-sliced; `off`: apps left stopped while memory-sliced.
 */
function readPlan() {
  const stored = readJsonFile(planPath());
  const names = (list) => (Array.isArray(list) ? list.filter((app) => typeof app === "string" && app) : []);
  const slices = stored?.slices && typeof stored.slices === "object" && !Array.isArray(stored.slices) ? stored.slices : {};
  return { apps: names(stored?.apps), slices, off: names(stored?.off) };
}

function writePlan(plan) {
  writeJsonFile(planPath(), plan);
}

function union(...lists) {
  return [...new Set(lists.flat())];
}

/** Adds the card's current bindings to the plan; their slice sizes too when leaving MemorySlice. */
function rememberBound(gpu, leaving) {
  const plan = readPlan();
  const slices = { ...plan.slices };
  if (leaving && gpu.type === "MemorySlice") {
    for (const binding of gpu.bindings) {
      if (binding.memory > 0) slices[binding.app] = binding.memory;
    }
  }
  writePlan({ ...plan, apps: union(plan.apps, gpu.bindings.map((binding) => binding.app)), slices });
}

const QUANTITY_UNITS = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, K: 1e3, M: 1e6, G: 1e9, T: 1e12 };

/** Kubernetes quantity ("6Gi", "512Mi") → bytes; 0 when absent or unreadable. */
export function parseQuantity(text) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([KMGT]i?)?\s*$/.exec(String(text ?? ""));
  if (!match) return 0;
  return Math.round(Number(match[1]) * (match[2] ? QUANTITY_UNITS[match[2]] : 1));
}

/**
 * The user's apps that need an NVIDIA card, across every market source.
 * Each manifest is read from the source the app was installed from, since
 * catalog and uploaded charts can ask for different memory.
 * @returns {Promise<{ app: string, title: string, source: string, phase: string, required: number }[]>}
 */
export async function gpuApps(options = {}) {
  const mine = await runOlaresCli(["market", "list", "--mine", "-o", "json"], options.spawnFn);
  if (mine.code !== 0 || !Array.isArray(mine.json)) throw new VoiceError("voice_gpu_failed", 502, mine.message);
  const apps = await Promise.all(mine.json.map(async (row) => {
    const app = typeof row?.name === "string" ? row.name : "";
    if (!app) return null;
    const args = ["market", "get", app, "-o", "json"];
    if (typeof row.source === "string" && row.source) args.splice(3, 0, "-s", row.source);
    const detail = await runOlaresCli(args, options.spawnFn, MANIFEST_LIMIT);
    const accelerators = detail.json?.app_info?.app_entry?.accelerator;
    const nvidia = Array.isArray(accelerators) ? accelerators.find((item) => item?.mode === "nvidia") : null;
    if (!nvidia) return null;
    return {
      app,
      title: typeof row.title === "string" && row.title ? row.title : app,
      source: String(row.source ?? ""),
      phase: chartPhase(row),
      required: parseQuantity(nvidia.requiredGPUMemory),
    };
  }));
  return apps.filter(Boolean);
}

function speechDevice(nodes) {
  const devices = (Array.isArray(nodes) ? nodes : [])
    .flatMap((node) => (Array.isArray(node?.devices) ? node.devices : []))
    .filter((device) => device?.mode === "nvidia");
  const speechApps = new Set(Object.values(VOICE_CHARTS).map((chart) => chart.app));
  return devices.find((device) => (device.bindings ?? []).some((binding) => speechApps.has(binding?.appName)))
    ?? devices[0]
    ?? null;
}

/**
 * The NVIDIA card the speech models are bound to.
 * @returns {Promise<{ node: string, device: string, model: string, type: string, memory: number, available: string[], bindings: { app: string, memory: number }[] } | null>}
 */
export async function speechGpu(options = {}) {
  const result = await runOlaresCli(["settings", "compute", "list", "-o", "json"], options.spawnFn);
  if (result.code !== 0 || !Array.isArray(result.json)) {
    throw new VoiceError("voice_gpu_failed", 502, result.message);
  }
  const device = speechDevice(result.json);
  if (!device) return null;
  return {
    node: String(device.nodeName ?? ""),
    device: String(device.id ?? ""),
    model: String(device.cardModel ?? ""),
    type: String(device.supportType ?? ""),
    memory: Number(device.memory) || 0,
    available: Array.isArray(device.availableSupportTypes) ? device.availableSupportTypes.map(String) : [],
    bindings: (device.bindings ?? []).map((binding) => ({
      app: String(binding?.appName ?? ""),
      memory: Number(binding?.memory) || 0,
    })).filter((binding) => binding.app),
  };
}

/**
 * The memory-slice plan the settings panel edits: every app known to use the
 * card, whether it takes part, and its slice in bytes. A running slice shows
 * its live size. `kind` names the speech models; other apps have none.
 */
function slicePlan(gpu, plan, apps = []) {
  const kinds = new Map(Object.entries(VOICE_CHARTS).map(([kind, chart]) => [chart.app, kind]));
  const known = new Map(apps.map((entry) => [entry.app, entry]));
  const live = gpu?.type === "MemorySlice" ? new Map(gpu.bindings.map((binding) => [binding.app, binding.memory])) : new Map();
  const names = union(plan.apps, gpu?.bindings.map((binding) => binding.app) ?? [], Object.keys(plan.slices), apps.map((entry) => entry.app));
  return names.map((app) => {
    const memory = live.get(app) || Number(plan.slices[app]) || 0;
    return {
      app,
      kind: kinds.get(app) ?? "",
      title: known.get(app)?.title ?? app,
      required: known.get(app)?.required ?? 0,
      enabled: memory > 0 && !plan.off.includes(app),
      memory,
    };
  });
}

function sliceFlag(gpu, app, plan) {
  return `${gpu.node}:${gpu.device}:${Math.round(Number(plan.slices[app]) / MIB)}Mi`;
}

let job = null;

/** The switch in progress or last finished, for the settings panel to poll. */
export function gpuSwitchJob() {
  return job ? { ...job, apps: job.apps.map((app) => ({ ...app })) } : null;
}

/**
 * Moves the speech card to the type the reading mode needs and its apps to
 * the plan. Switching the type stops every app bound to the card; within
 * MemorySlice only apps whose slice changed are stopped and rebound. Apps
 * resume smallest first, so the LLM is not starved of a slice.
 * Returns at once; the job runs on and reports through `gpuSwitchJob`.
 */
export function startGpuSwitch(streaming, options = {}) {
  if (job?.phase === "switching" || job?.phase === "resuming") {
    throw new VoiceError("voice_gpu_busy", 409, "the GPU is already switching");
  }
  const target = gpuTypeFor(streaming);
  job = { target, phase: "switching", startedAt: Date.now(), apps: [], error: "" };
  const current = job;
  void runSwitch(current, options).catch((err) => {
    current.phase = "failed";
    current.error = err instanceof Error ? err.message : String(err);
  });
  return gpuSwitchJob();
}

async function runSwitch(current, options) {
  const run = (args) => runOlaresCli(args, options.spawnFn);
  // set-type and unbind return before their stops settle, and a resume against a stopping app is refused.
  const stop = (app) => run(["market", "stop", app, "--watch", "--watch-timeout", "10m", "-o", "json"]);
  const gpu = await speechGpu(options);
  if (!gpu) throw new VoiceError("voice_gpu_failed", 404, "no NVIDIA GPU found");
  const sliced = current.target === "MemorySlice";
  const switching = gpu.type !== current.target;
  if (gpu.bindings.length) rememberBound(gpu, switching);
  const plan = readPlan();
  const kept = new Set();
  if (switching) {
    if (!gpu.available.includes(current.target)) {
      throw new VoiceError("voice_gpu_failed", 400, `this GPU does not support ${current.target}`);
    }
    for (const binding of gpu.bindings) await stop(binding.app);
    const switched = await run(["settings", "compute", "set-type", gpu.node, gpu.device, "--type", current.target, "--yes", "-o", "json"]);
    if (switched.code !== 0) throw new VoiceError("voice_gpu_failed", 502, switched.message);
  } else if (sliced) {
    for (const binding of gpu.bindings) {
      const wanted = plan.off.includes(binding.app) ? 0 : Number(plan.slices[binding.app]) || 0;
      if (wanted === binding.memory) {
        kept.add(binding.app);
        continue;
      }
      await stop(binding.app);
      const unbound = await run(["settings", "compute", "unbind", binding.app, "--yes", "-o", "json"]);
      if (unbound.code !== 0) throw new VoiceError("voice_gpu_failed", 502, unbound.message);
    }
  }
  current.phase = "resuming";
  const apps = (sliced
    ? slicePlan(null, plan).filter((entry) => entry.enabled).map((entry) => entry.app)
    : plan.apps
  ).sort((a, b) => (Number(plan.slices[a]) || Infinity) - (Number(plan.slices[b]) || Infinity));
  for (const app of apps) {
    const entry = { app, ok: false, message: "" };
    current.apps.push(entry);
    if (kept.has(app)) {
      entry.ok = true;
      continue;
    }
    const resumed = await run([
      "market", "resume", app,
      "--compute-binding", sliced ? sliceFlag(gpu, app, plan) : `${gpu.node}:${gpu.device}`,
      "--watch", "--watch-timeout", "15m", "-o", "json",
    ]);
    entry.ok = resumed.code === 0;
    if (!entry.ok) entry.message = resumed.message;
  }
  current.phase = current.apps.every((app) => app.ok) ? "done" : "partial";
}

/** What the settings panel shows: the reading mode, the card, its slice plan, and any switch in progress. */
export async function gpuModePayload(options = {}) {
  let gpu = null;
  let error = "";
  try {
    gpu = await speechGpu(options);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  let apps = [];
  try {
    apps = await gpuApps(options);
  } catch (err) {
    error ||= err instanceof Error ? err.message : String(err);
  }
  const streaming = readConfig().streaming;
  const bound = new Set(gpu?.bindings.map((binding) => binding.app) ?? []);
  return {
    streaming,
    target: gpuTypeFor(streaming),
    gpu: gpu ? { type: gpu.type, model: gpu.model, memory: gpu.memory, available: gpu.available, apps: [...bound] } : null,
    plan: slicePlan(gpu, readPlan(), apps),
    apps: apps.map((entry) => ({
      ...entry,
      bound: bound.has(entry.app),
      pending: pendingApps.get(entry.app) ?? "",
      error: appErrors.get(entry.app) ?? "",
    })),
    job: gpuSwitchJob(),
    error,
  };
}

/** Saves the reading mode and starts moving the card to the type it needs. */
export async function switchReadingMode(streaming, options = {}) {
  if (typeof streaming !== "boolean") throw new VoiceError("voice_config_invalid", 400, "streaming must be a boolean");
  startGpuSwitch(streaming, options);
  writeConfig({ streaming });
  return gpuModePayload(options);
}

/**
 * Saves which apps take part in memory slicing and how much each gets.
 * Applied at once while the card is memory-sliced, else at the next switch.
 * @param {unknown} entries `[{ app, enabled, memory }]`, memory in bytes
 */
export async function saveSlicePlan(entries, options = {}) {
  const invalid = (message) => {
    throw new VoiceError("voice_config_invalid", 400, message);
  };
  if (!Array.isArray(entries)) invalid("plan must be a list");
  const gpu = await speechGpu(options);
  if (!gpu) throw new VoiceError("voice_gpu_failed", 404, "no NVIDIA GPU found");
  const plan = readPlan();
  const candidates = slicePlan(gpu, plan, await gpuApps(options));
  const known = new Set(candidates.map((entry) => entry.app));
  const required = new Map(candidates.map((entry) => [entry.app, entry.required]));
  const slices = { ...plan.slices };
  const off = new Set(plan.off);
  let total = 0;
  for (const entry of entries) {
    const app = entry?.app;
    if (typeof app !== "string" || !known.has(app)) invalid(`unknown app ${String(app)}`);
    if (typeof entry.enabled !== "boolean") invalid(`${app}: enabled must be a boolean`);
    const memory = Number(entry.memory);
    const floor = Math.max(256 * MIB, required.get(app) || 0);
    if (entry.enabled && !(Number.isFinite(memory) && memory >= floor)) {
      invalid(`${app}: memory must be at least ${Math.round(floor / MIB)}Mi`);
    }
    if (Number.isFinite(memory) && memory > 0) slices[app] = Math.round(memory / MIB) * MIB;
    if (entry.enabled) {
      off.delete(app);
      total += slices[app];
    } else {
      off.add(app);
    }
  }
  if (gpu.memory > 0 && total > gpu.memory) invalid("slices exceed the GPU memory");
  writePlan({ apps: union(plan.apps, gpu.bindings.map((binding) => binding.app)), slices, off: [...off] });
  if (gpu.type === "MemorySlice") startGpuSwitch(true, options);
  return gpuModePayload(options);
}

const pendingApps = new Map();

/** Market refuses an op on an app already where the op would take it; that still counts. */
async function settledAs(app, phase, options) {
  const status = await runOlaresCli(["market", "status", app, "-a", "-o", "json"], options.spawnFn);
  return chartPhase(currentChartRow(status.json)) === phase;
}
const appErrors = new Map();

/**
 * Starts or stops one GPU app on the speech card, in the background. A started
 * app is resumed again whenever the card goes back to time slicing; a stopped
 * one is not. While memory-sliced an app can only start into its planned slice.
 * @param {string} app
 * @param {"resume" | "stop"} op
 */
export async function gpuAppAction(app, op, options = {}) {
  if (op !== "resume" && op !== "stop") throw new VoiceError("voice_config_invalid", 400, "op must be resume or stop");
  if (job?.phase === "switching" || job?.phase === "resuming" || pendingApps.has(app)) {
    throw new VoiceError("voice_gpu_busy", 409, "the GPU is busy");
  }
  const [gpu, apps] = await Promise.all([speechGpu(options), gpuApps(options)]);
  if (!gpu) throw new VoiceError("voice_gpu_failed", 404, "no NVIDIA GPU found");
  if (!apps.some((entry) => entry.app === app)) throw new VoiceError("voice_config_invalid", 400, `${app} is not a GPU app`);
  const plan = readPlan();
  let binding = `${gpu.node}:${gpu.device}`;
  if (op === "resume" && gpu.type === "MemorySlice") {
    if (plan.off.includes(app) || !(Number(plan.slices[app]) > 0)) {
      throw new VoiceError("voice_config_invalid", 400, `${app} has no memory slice`);
    }
    binding = sliceFlag(gpu, app, plan);
  }
  const args = op === "stop"
    ? ["market", "stop", app, "--watch", "--watch-timeout", "10m", "-o", "json"]
    : ["market", "resume", app, "--compute-binding", binding, "--watch", "--watch-timeout", "15m", "-o", "json"];
  pendingApps.set(app, op);
  appErrors.delete(app);
  void runOlaresCli(args, options.spawnFn)
    .then(async (result) => {
      if (result.code !== 0 && !(await settledAs(app, op === "stop" ? "stopped" : "running", options))) {
        appErrors.set(app, result.message);
        return;
      }
      const latest = readPlan();
      const kept = latest.apps.filter((name) => name !== app);
      writePlan({ ...latest, apps: op === "resume" ? [...kept, app] : kept });
    })
    .catch((err) => appErrors.set(app, err instanceof Error ? err.message : String(err)))
    .finally(() => pendingApps.delete(app));
  return gpuModePayload(options);
}
