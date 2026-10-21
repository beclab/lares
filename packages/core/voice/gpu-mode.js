import { readFile } from "node:fs/promises";
import https from "node:https";
import { readJsonFile, writeJsonFile } from "../tools/json-file.js";
import { dshPluginConfigPath } from "../workspace/home.js";
import { VoiceError } from "../router/stt.js";
import { readConfig, writeConfig } from "./config.js";
import { cliProblem, gpuProblem } from "./gpu-problem.js";
import { chartPhase, currentChartRow, runOlaresCli, VOICE_CHARTS } from "./install.js";

/** A GPU failure the settings panel explains; `params` reach the browser beside the code. */
export class GpuError extends VoiceError {
  /** @param {import('./gpu-problem.js').GpuProblem} problem */
  constructor(problem, status = 502) {
    super(problem.code, status, problem.detail || problem.code);
    this.params = problem.params;
    this.problem = problem;
  }
}

function problemOf(err) {
  if (err instanceof GpuError) return err.problem;
  return gpuProblem("voice_gpu_failed", {}, err instanceof Error ? err.message : String(err));
}

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
  const mine = await runOlaresCli(["market", "list", "--mine", "-o", "json"], options.spawnFn, MANIFEST_LIMIT);
  if (mine.code !== 0 || !Array.isArray(mine.json)) throw new GpuError(cliProblem(mine, "voice_gpu_failed"));
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

let seenGpu = undefined;

/** Last card `speechGpu` observed. `undefined` means it has not been asked yet. */
export function noteSpeechGpu(gpu) {
  seenGpu = gpu ?? null;
}

/**
 * Read-while-writing only while the saved mode asks for it and the card is
 * memory-sliced. Time slicing cannot keep the language model and speech model
 * resident together, so a saved streaming flag does not override that.
 */
export function streamingEnabled() {
  return readConfig().streaming === true && seenGpu?.type === "MemorySlice";
}

/** What the reading-mode control needs, without listing every GPU app. */
export async function readingModePayload(options = {}) {
  let gpu = null;
  let problem = null;
  try {
    gpu = await speechGpu(options);
  } catch (err) {
    problem = problemOf(err);
  }
  return {
    streaming: readConfig().streaming === true,
    allowed: gpu?.type === "MemorySlice",
    gpu: gpu ? { type: gpu.type, model: gpu.model } : null,
    problem,
  };
}

function gpuFromDevice(device) {
  const gpu = {
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
  noteSpeechGpu(gpu);
  return gpu;
}

const SHARE_MODE_PREFIX = "sharemode.gpu.bytetrade.io/";
const NVIDIA_REGISTER = "hami.io/node-nvidia-register";

/**
 * Node annotation `sharemode.gpu.bytetrade.io/<uuid>` uses the platform's
 * legacy codes: 0 exclusive, 1 memory slice, anything else time slice.
 */
export function supportTypeFromShareMode(mode) {
  if (mode === "0") return "Exclusive";
  if (mode === "1") return "MemorySlice";
  return "TimeSlice";
}

/**
 * The card the speech models use, from the node's share-mode annotation and
 * the GPUBinding objects. Memory in those objects is MiB.
 * @returns {ReturnType<typeof gpuFromDevice> | null}
 */
export function gpuFromClusterState(nodeList, bindingList) {
  const nodes = Array.isArray(nodeList?.items) ? nodeList.items : [];
  const bindings = Array.isArray(bindingList?.items) ? bindingList.items : [];
  const speechApps = new Set(Object.values(VOICE_CHARTS).map((chart) => chart.app));
  const cards = [];
  for (const node of nodes) {
    const annotations = node?.metadata?.annotations ?? {};
    const register = String(annotations[NVIDIA_REGISTER] ?? "");
    const rows = register.split(":").map((row) => row.split(",")).filter((fields) => fields[0]);
    for (const [key, value] of Object.entries(annotations)) {
      if (!key.startsWith(SHARE_MODE_PREFIX)) continue;
      const device = key.slice(SHARE_MODE_PREFIX.length);
      if (!device) continue;
      const card = rows.find((fields) => fields[0] === device);
      const bound = bindings.filter((item) => item?.spec?.uuid === device);
      cards.push({
        node: String(node?.metadata?.name ?? ""),
        device,
        model: card?.[4] ? String(card[4]) : "",
        type: supportTypeFromShareMode(String(value ?? "").trim()),
        memory: card ? (Number(card[2]) || 0) * MIB : 0,
        available: ["TimeSlice", "MemorySlice", "Exclusive"],
        bindings: bound.map((item) => ({
          app: String(item?.spec?.appName ?? ""),
          memory: (Number(item?.spec?.memory) || 0) * MIB,
        })).filter((binding) => binding.app),
      });
    }
  }
  const chosen = cards.find((card) => card.bindings.some((binding) => speechApps.has(binding.app))) ?? cards[0] ?? null;
  if (!chosen) return null;
  noteSpeechGpu(chosen);
  return chosen;
}

function kubeGet(path) {
  return new Promise((resolve, reject) => {
    Promise.all([
      readFile("/var/run/secrets/kubernetes.io/serviceaccount/token", "utf8"),
      readFile("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"),
    ]).then(([token, ca]) => {
      const req = https.request({
        hostname: "kubernetes.default.svc",
        path,
        method: "GET",
        ca,
        headers: { Authorization: `Bearer ${token.trim()}` },
        timeout: 8000,
      }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`kubernetes ${path} returned ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("kubernetes API timed out")));
      req.end();
    }).catch(reject);
  });
}

async function speechGpuFromCluster(options) {
  const get = options.kubeGet ?? kubeGet;
  const [nodes, bindings] = await Promise.all([
    get("/api/v1/nodes"),
    get("/apis/gpu.bytetrade.io/v1alpha1/gpubindings"),
  ]);
  return gpuFromClusterState(nodes, bindings);
}

/**
 * The NVIDIA card the speech models are bound to.
 * The pod CLI profile is the first source. When that profile is not mounted,
 * the node's share-mode annotation is the same fact the settings page shows.
 * @returns {Promise<{ node: string, device: string, model: string, type: string, memory: number, available: string[], bindings: { app: string, memory: number }[] } | null>}
 */
export async function speechGpu(options = {}) {
  const result = await runOlaresCli(["settings", "compute", "list", "-o", "json"], options.spawnFn);
  if (result.code === 0 && Array.isArray(result.json)) {
    const device = speechDevice(result.json);
    if (!device) {
      noteSpeechGpu(null);
      return null;
    }
    return gpuFromDevice(device);
  }
  const problem = cliProblem(result, "voice_gpu_failed");
  if (problem.code === "voice_gpu_login") {
    try {
      return await speechGpuFromCluster(options);
    } catch {
      /* The annotation is unreadable; the CLI failure is what we can report. */
    }
  }
  throw new GpuError(problem);
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

/** The binding an app had before this switch touched it, to put it back after a failure. */
function bindingFlag(gpu, binding) {
  return gpu.type === "MemorySlice" && binding.memory > 0
    ? `${gpu.node}:${gpu.device}:${Math.round(binding.memory / MIB)}Mi`
    : `${gpu.node}:${gpu.device}`;
}

function gib(bytes) {
  return Math.round((bytes / 2 ** 30) * 10) / 10;
}

/**
 * Entering MemorySlice with no slice planned would stop every app and start
 * none. The first time, each running app on the card gets its manifest
 * minimum; when that cannot fit, or nothing qualifies, the user plans it.
 */
async function ensureSlices(gpu, plan, options) {
  if (slicePlan(null, plan).some((entry) => entry.enabled)) return plan;
  const onCard = new Set(union(plan.apps, gpu.bindings.map((binding) => binding.app)));
  const seeded = (await gpuApps(options)).filter((entry) => (
    onCard.has(entry.app) && entry.phase === "running" && entry.required > 0 && !plan.off.includes(entry.app)
  ));
  if (!seeded.length) throw new GpuError(gpuProblem("voice_gpu_plan_empty"), 409);
  const need = seeded.reduce((sum, entry) => sum + entry.required, 0);
  if (gpu.memory > 0 && need > gpu.memory) {
    throw new GpuError(gpuProblem("voice_gpu_plan_over", { need: gib(need), total: gib(gpu.memory) }), 409);
  }
  const slices = { ...plan.slices };
  for (const entry of seeded) slices[entry.app] = Math.ceil(entry.required / MIB) * MIB;
  const next = { ...plan, slices };
  writePlan(next);
  return next;
}

let job = null;

const BUSY = new Set(["switching", "restoring", "resuming"]);

/** The switch in progress or last finished, for the settings panel to poll. */
export function gpuSwitchJob() {
  if (!job) return null;
  return { ...job, apps: job.apps.map((app) => ({ ...app })), restored: job.restored.map((app) => ({ ...app })) };
}

/**
 * Moves the speech card to the type the reading mode needs and its apps to
 * the plan. Switching the type stops every app bound to the card; within
 * MemorySlice only apps whose slice changed are stopped and rebound. Apps
 * resume smallest first, so the LLM is not starved of a slice.
 * The reading mode is saved only once the card is where it needs to be; a
 * failure before that puts the stopped apps back on their old bindings.
 * Returns at once; the job runs on and reports through `gpuSwitchJob`.
 */
export function startGpuSwitch(streaming, options = {}) {
  if (BUSY.has(job?.phase)) {
    throw new GpuError(gpuProblem("voice_gpu_busy"), 409);
  }
  const target = gpuTypeFor(streaming);
  job = { target, phase: "switching", startedAt: Date.now(), apps: [], restored: [], problem: null };
  const current = job;
  void runSwitch(current, streaming, options).catch((err) => {
    current.phase = "failed";
    current.problem = problemOf(err);
  });
  return gpuSwitchJob();
}

async function runSwitch(current, streaming, options) {
  const run = (args) => runOlaresCli(args, options.spawnFn);
  const gpu = await speechGpu(options);
  const sliced = current.target === "MemorySlice";
  if (!gpu) {
    if (sliced) throw new GpuError(gpuProblem("voice_gpu_no_gpu"), 404);
    writeConfig({ streaming });
    current.phase = "done";
    return;
  }
  const switching = gpu.type !== current.target;
  if (switching && !gpu.available.includes(current.target)) {
    throw new GpuError(gpuProblem("voice_gpu_unsupported", { model: gpu.model || gpu.device }), 400);
  }
  if (gpu.bindings.length) rememberBound(gpu, switching);
  const plan = sliced ? await ensureSlices(gpu, readPlan(), options) : readPlan();
  const kept = new Set();
  const stopped = [];
  // set-type and unbind return before their stops settle, and a resume against a stopping app is refused.
  const stop = async (binding) => {
    const result = await run(["market", "stop", binding.app, "--watch", "--watch-timeout", "10m", "-o", "json"]);
    if (result.code !== 0 && !(await settledAs(binding.app, "stopped", options))) {
      throw new GpuError(cliProblem(result, "voice_gpu_stop_failed", { app: binding.app }));
    }
    stopped.push(binding);
  };
  try {
    if (switching) {
      for (const binding of gpu.bindings) await stop(binding);
      const switched = await run(["settings", "compute", "set-type", gpu.node, gpu.device, "--type", current.target, "--yes", "-o", "json"]);
      if (switched.code !== 0) {
        throw new GpuError(cliProblem(switched, "voice_gpu_failed"));
      }
    } else if (sliced) {
      for (const binding of gpu.bindings) {
        const wanted = plan.off.includes(binding.app) ? 0 : Number(plan.slices[binding.app]) || 0;
        if (wanted === binding.memory) {
          kept.add(binding.app);
          continue;
        }
        await stop(binding);
        const unbound = await run(["settings", "compute", "unbind", binding.app, "--yes", "-o", "json"]);
        if (unbound.code !== 0) throw new GpuError(cliProblem(unbound, "voice_gpu_failed", { app: binding.app }));
      }
    }
  } catch (err) {
    current.phase = "restoring";
    for (const binding of stopped) {
      const resumed = await resumeApp(binding.app, bindingFlag(gpu, binding), options);
      current.restored.push({ app: binding.app, ok: !resumed });
    }
    throw err;
  }
  writeConfig({ streaming });
  current.phase = "resuming";
  const apps = (sliced
    ? slicePlan(null, plan).filter((entry) => entry.enabled).map((entry) => entry.app)
    : plan.apps
  ).sort((a, b) => (Number(plan.slices[a]) || Infinity) - (Number(plan.slices[b]) || Infinity));
  for (const app of apps) {
    const entry = { app, ok: false, problem: null };
    current.apps.push(entry);
    if (kept.has(app)) {
      entry.ok = true;
      continue;
    }
    entry.problem = await resumeApp(app, sliced ? sliceFlag(gpu, app, plan) : `${gpu.node}:${gpu.device}`, options);
    entry.ok = !entry.problem;
  }
  current.phase = current.apps.every((app) => app.ok) ? "done" : "partial";
}

/** Resumes one app onto the card; null once it runs, else why it did not. */
async function resumeApp(app, binding, options) {
  const resumed = await runOlaresCli([
    "market", "resume", app,
    "--compute-binding", binding,
    "--watch", "--watch-timeout", "15m", "-o", "json",
  ], options.spawnFn);
  if (resumed.code === 0 || await settledAs(app, "running", options)) return null;
  return cliProblem(resumed, "voice_gpu_resume_failed", { app });
}

/** What the settings panel shows: the reading mode, the card, its slice plan, and any switch in progress. */
export async function gpuModePayload(options = {}) {
  let gpu = null;
  let problem = null;
  try {
    gpu = await speechGpu(options);
  } catch (err) {
    problem = problemOf(err);
  }
  let apps = [];
  try {
    apps = await gpuApps(options);
  } catch (err) {
    problem ||= problemOf(err);
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
      problem: appErrors.get(entry.app) ?? null,
    })),
    job: gpuSwitchJob(),
    problem,
  };
}

/** Starts moving the card to the type the reading mode needs; the mode is saved once it gets there. */
export async function switchReadingMode(streaming, options = {}) {
  if (typeof streaming !== "boolean") throw new VoiceError("voice_config_invalid", 400, "streaming must be a boolean");
  startGpuSwitch(streaming, options);
  return gpuModePayload(options);
}

/**
 * Saves which apps take part in memory slicing and how much each gets.
 * Applied at once while the card is memory-sliced, else at the next switch.
 * @param {unknown} entries `[{ app, enabled, memory }]`, memory in bytes
 */
export async function saveSlicePlan(entries, options = {}) {
  const invalid = (code, params, detail) => {
    throw new GpuError(gpuProblem(code, params, detail), 400);
  };
  if (!Array.isArray(entries)) throw new VoiceError("voice_config_invalid", 400, "plan must be a list");
  const gpu = await speechGpu(options);
  if (!gpu) throw new GpuError(gpuProblem("voice_gpu_no_gpu"), 404);
  const plan = readPlan();
  const candidates = slicePlan(gpu, plan, await gpuApps(options));
  const known = new Set(candidates.map((entry) => entry.app));
  const required = new Map(candidates.map((entry) => [entry.app, entry.required]));
  const slices = { ...plan.slices };
  const off = new Set(plan.off);
  let total = 0;
  for (const entry of entries) {
    const app = entry?.app;
    if (typeof app !== "string" || !known.has(app)) invalid("voice_gpu_unknown_app", { app: String(app) }, `unknown app ${String(app)}`);
    if (typeof entry.enabled !== "boolean") throw new VoiceError("voice_config_invalid", 400, `${app}: enabled must be a boolean`);
    const memory = Number(entry.memory);
    const floor = Math.max(256 * MIB, required.get(app) || 0);
    if (entry.enabled && !(Number.isFinite(memory) && memory >= floor)) {
      invalid("voice_gpu_plan_floor", { app, size: gib(floor) }, `${app}: memory must be at least ${Math.round(floor / MIB)}Mi`);
    }
    if (Number.isFinite(memory) && memory > 0) slices[app] = Math.round(memory / MIB) * MIB;
    if (entry.enabled) {
      off.delete(app);
      total += slices[app];
    } else {
      off.add(app);
    }
  }
  if (gpu.memory > 0 && total > gpu.memory) {
    invalid("voice_gpu_plan_over", { need: gib(total), total: gib(gpu.memory) }, "slices exceed the GPU memory");
  }
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
  if (BUSY.has(job?.phase) || pendingApps.has(app)) {
    throw new GpuError(gpuProblem("voice_gpu_busy"), 409);
  }
  const [gpu, apps] = await Promise.all([speechGpu(options), gpuApps(options)]);
  if (!gpu) throw new GpuError(gpuProblem("voice_gpu_no_gpu"), 404);
  if (!apps.some((entry) => entry.app === app)) {
    throw new GpuError(gpuProblem("voice_gpu_unknown_app", { app }, `${app} is not a GPU app`), 400);
  }
  const plan = readPlan();
  let binding = `${gpu.node}:${gpu.device}`;
  if (op === "resume" && gpu.type === "MemorySlice") {
    if (plan.off.includes(app) || !(Number(plan.slices[app]) > 0)) {
      throw new GpuError(gpuProblem("voice_gpu_no_slice", { app }, `${app} has no memory slice`), 400);
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
        appErrors.set(app, cliProblem(result, op === "stop" ? "voice_gpu_stop_failed" : "voice_gpu_resume_failed", { app }));
        return;
      }
      const latest = readPlan();
      const kept = latest.apps.filter((name) => name !== app);
      writePlan({ ...latest, apps: op === "resume" ? [...kept, app] : kept });
    })
    .catch((err) => appErrors.set(app, problemOf(err)))
    .finally(() => pendingApps.delete(app));
  return gpuModePayload(options);
}
