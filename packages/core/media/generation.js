import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, extname, join } from "node:path";
import { attachFlowstudioFilesPaths } from "../drive/flowstudio-files.js";
import { routerEndUser, routerGatewayUrl, routerHeaders } from "../router/gateway.js";
import { withSref } from "../router/sref.js";
import {
  prepareWorkspaceTarget,
  resolveExistingWorkspacePath,
  resolveWorkspaceRoot,
  workspaceCandidate,
} from "../workspace/path.js";
import { carriesWebpImage, transcodeWebpImages } from "./router-images.js";
import {
  MEDIA_GENERATION_ROUTES,
  bindParams,
  fetchCatalogRow,
  mediaSlots,
  planGeneration,
  promptParameterKey,
  rowContract,
} from "./catalog-row.js";

export { MEDIA_GENERATION_ROUTES };

/** A long video on a busy local GPU has been measured at nine minutes. */
export const MEDIA_GENERATION_TIMEOUT_MS = 60 * 60 * 1000;
export const MEDIA_POLL_INTERVAL_MS = 5_000;
const MAX_REFERENCE_IMAGES = 4;
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const MAX_TRANSIENT_FAILURES = 12;

export const MEDIA_SUBMITTED_EVENT = "media/generation-submitted";
export const MEDIA_SETTLED_EVENT = "media/generation-settled";

const IMAGE_TYPES = Object.freeze({
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
});

const TERMINAL = new Set(["completed", "failed", "canceled", "cancelled"]);

/**
 * A 1×1 PNG for Router's pass-check fields. Router refuses an edit row without
 * inputs.images before it forwards; FlowStudio ignores these once the media are
 * named by slot in flowstudio.params. It never reaches a workflow.
 */
export const PASS_CHECK_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Home/FlowStudio: the Files folder Lares and FlowStudio share (mounted from userData). */
export const FLOWSTUDIO_UPLOADS_FILES_PATH = "drive/Home/FlowStudio/uploads";

/**
 * A slot value as FlowStudio reads it: a file in the user's Home/FlowStudio.
 * A `drive/…` address is passed as given (an earlier output under
 * Home/FlowStudio/outputs, or an upload already there). A workspace file — an
 * upload into this chat, a file the agent made — is copied into
 * Home/FlowStudio/uploads first, named by its content so a second run reuses it.
 */
export async function slotFilesPath(workspaceRoot, value, env = process.env, deps = {}) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.startsWith("drive/")) return raw;
  const shared = String(env.LARES_FLOWSTUDIO_FILES_DIR ?? "").trim();
  if (!shared) {
    throw new MediaGenerationError("Home/FlowStudio is not mounted in Lares; cannot hand this file to FlowStudio");
  }
  const root = await resolveWorkspaceRoot(workspaceRoot);
  const absolute = await resolveExistingWorkspacePath(root, workspaceCandidate(root, raw));
  const bytes = await readFile(absolute);
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const name = `${digest}_${basename(absolute).replace(/[^\w.\-\u4e00-\u9fff]+/g, "_")}`;
  const target = join(shared, "uploads", name);
  await (deps.mkdir ?? mkdir)(join(shared, "uploads"), { recursive: true });
  await (deps.writeFile ?? writeFile)(target, bytes, { flag: "wx" }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  return `${FLOWSTUDIO_UPLOADS_FILES_PATH}/${name}`;
}

async function slotParams(contract, params, workspaceRoot, env, deps = {}) {
  if (!params || typeof params !== "object" || Array.isArray(params)) return params;
  const out = { ...params };
  for (const slot of mediaSlots(contract)) {
    if (!(slot.key in out)) continue;
    const value = out[slot.key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const mapped = {};
      for (const [name, path] of Object.entries(value)) mapped[name] = await slotFilesPath(workspaceRoot, path, env, deps);
      out[slot.key] = mapped;
    } else {
      out[slot.key] = await slotFilesPath(workspaceRoot, value, env, deps);
    }
  }
  return out;
}

export class MediaGenerationError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, status?: number, retryable?: boolean, retryAfterSeconds?: number, id?: string }} [facts]
   */
  constructor(message, facts = {}) {
    super(message);
    this.name = "MediaGenerationError";
    this.code = facts.code ?? "";
    this.status = facts.status ?? 0;
    this.retryable = facts.retryable === true;
    this.retryAfterSeconds = facts.retryAfterSeconds ?? 0;
    this.id = facts.id ?? "";
  }
}

/**
 * Input images are read from the session workspace and sent as data URLs: the
 * upstream cannot read a path on this pod. The request builder chooses the
 * released `reference_images` spelling or canonical `inputs.images` spelling.
 */
export async function referenceImageDataUrl(workspaceRoot, path) {
  const type = IMAGE_TYPES[extname(String(path)).toLowerCase()];
  if (!type) throw new MediaGenerationError(`${path} is not a png, jpeg, webp, or gif image`);
  const root = await resolveWorkspaceRoot(workspaceRoot);
  const absolute = await resolveExistingWorkspacePath(root, workspaceCandidate(root, String(path)));
  const bytes = await readFile(absolute);
  if (bytes.length === 0 || bytes.length > MAX_REFERENCE_BYTES) {
    throw new MediaGenerationError(`${path} must be a non-empty image of at most 10 MiB`);
  }
  return `data:${type};base64,${bytes.toString("base64")}`;
}

/**
 * Build the Router request for one catalog row.
 *
 * Nothing about the workflow is decided here: the row's contract (see
 * catalog-row.js) supplies the route, the operation, where images go, and the
 * parameters `params` may name. Every tunable travels as `flowstudio.params`.
 *
 * @param {ReturnType<typeof rowContract>} contract
 * @returns {{ mode: string, route: string, body: Record<string, unknown> }}
 */
export function mediaGenerationRequest(contract, args, referenceImages = []) {
  const model = String(args?.model ?? "").trim();
  if (!model.includes("/")) throw new MediaGenerationError("model must be <provider>/<model> as the catalog lists it");
  if (args?.options !== undefined) {
    throw new MediaGenerationError("options is not a media_generate field; put the row's parameters in params");
  }
  if (referenceImages.length > MAX_REFERENCE_IMAGES) {
    throw new MediaGenerationError(`at most ${MAX_REFERENCE_IMAGES} reference images`);
  }
  const mask = String(args?.mask_image_data_url ?? "").trim();
  const params = bindParams(contract, args?.params ?? {});
  const slotMedia = mediaSlots(contract).some((slot) => slot.key in params);
  const plan = planGeneration(contract, { images: referenceImages.length, mask: Boolean(mask), slotMedia });
  // A FlowStudio workflow reads its prompt from params like any other
  // parameter. Router still wants a top-level prompt before it forwards; that
  // copy is only its pass-check and FlowStudio never reads it.
  const promptKey = promptParameterKey(contract);
  const fromParams = promptKey && typeof params[promptKey] === "string" ? params[promptKey] : "";
  const prompt = String(args?.prompt ?? "") || fromParams;
  const body = { model };
  if (prompt) body.prompt = prompt;
  if (plan.operation) body.operation = plan.operation;
  if (Object.keys(params).length > 0) body.flowstudio = { params };
  if (plan.canonical) {
    if (referenceImages.length > 0 || mask) {
      body.inputs = {};
      if (referenceImages.length > 0) body.inputs.images = referenceImages;
      if (mask) body.inputs.mask = mask;
    }
  } else {
    if (referenceImages.length > 0) body.reference_images = referenceImages;
    if (mask) body.maskImage = mask;
  }
  if (plan.passCheck.images || plan.passCheck.mask) {
    const placeholder = plan.canonical ? (body.inputs ??= {}) : body;
    if (plan.passCheck.images) placeholder[plan.canonical ? "images" : "reference_images"] = [PASS_CHECK_IMAGE];
    if (plan.passCheck.mask) {
      if (plan.canonical) placeholder.mask = PASS_CHECK_IMAGE;
      else body.maskImage = PASS_CHECK_IMAGE;
    }
  }
  return { mode: contract.mode, route: plan.route, body };
}

function retryAfterSeconds(response, payload) {
  const header = Number.parseInt(response?.headers?.get?.("retry-after") ?? "", 10);
  if (Number.isFinite(header) && header > 0) return header;
  const fromBody = Number(payload?.retry_after_seconds ?? 0);
  return Number.isFinite(fromBody) && fromBody > 0 ? fromBody : 0;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text.slice(0, 500) } };
  }
}

const MAX_ERROR_TEXT = 500;

function clip(text) {
  const value = String(text ?? "").trim();
  return value.length > MAX_ERROR_TEXT ? `${value.slice(0, MAX_ERROR_TEXT)}…` : value;
}

/**
 * Readable text for an error field of any shape Router or an upstream sends:
 * a string, `{ message }` (possibly nested, e.g. an upstream body relayed as
 * the message), FastAPI's `{ detail }` / validation `[{ loc, msg }]`, or
 * anything else as compact JSON. Never "[object Object]".
 */
export function errorText(value, depth = 0) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return clip(value);
  if (typeof value !== "object") return clip(String(value));
  if (depth > 4) return clip(safeJson(value));
  if (Array.isArray(value)) {
    return clip(value.map((item) => {
      if (item && typeof item === "object" && ("msg" in item || "loc" in item)) {
        const loc = Array.isArray(item.loc) ? item.loc.join(".") : String(item.loc ?? "");
        const msg = errorText(item.msg, depth + 1);
        return loc && msg ? `${loc}: ${msg}` : loc || msg;
      }
      return errorText(item, depth + 1);
    }).filter(Boolean).join("; "));
  }
  for (const key of ["message", "error", "detail", "msg", "reason", "description"]) {
    const text = errorText(value[key], depth + 1);
    if (text) return text;
  }
  // `code` / `type` are reported separately; JSON only what else is there.
  const rest = Object.fromEntries(
    Object.entries(value).filter(([key]) => !["code", "type", "status"].includes(key)),
  );
  return clip(safeJson(rest));
}

function safeJson(value) {
  try {
    const text = JSON.stringify(value);
    return text === "{}" || text === "[]" ? "" : text;
  } catch {
    return "";
  }
}

function errorCode(error) {
  if (!error || typeof error !== "object" || Array.isArray(error)) return "";
  const code = error.code ?? error.type ?? "";
  return typeof code === "string" || typeof code === "number" ? String(code).trim() : "";
}

function errorFromResponse(response, payload, id) {
  const error = payload?.error && typeof payload.error === "object" ? payload.error : {};
  const code = errorCode(error) || errorCode(payload);
  const text = errorText(payload?.error) || errorText(payload?.detail) || errorText(payload?.message);
  const fallback = `Router answered HTTP ${response.status}`;
  const message = text && text !== code ? text : fallback;
  const after = retryAfterSeconds(response, payload);
  return new MediaGenerationError(code ? `${code}: ${message}` : message, {
    code,
    status: response.status,
    retryable: response.status === 429 || response.status === 503 || after > 0,
    retryAfterSeconds: after,
    id,
  });
}

/** Failed generation → error naming the code and whether waiting helps. */
export function generationFailure(payload) {
  const code = String(payload?.error_code ?? "").trim() || errorCode(payload?.error);
  const raw = errorText(payload?.error);
  const text = raw === code ? "" : raw;
  const status = String(payload?.status ?? "failed");
  const detail = [code, text].filter(Boolean).join(": ") || `generation ${status}`;
  const retryable = payload?.retryable === true;
  const after = Number(payload?.retry_after_seconds ?? 0) || 0;
  const hint = retryable ? ` (retryable after ${after || 30}s)` : "";
  return new MediaGenerationError(`${detail}${hint}`, {
    code,
    retryable,
    retryAfterSeconds: after,
    id: String(payload?.id ?? ""),
  });
}

function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function transport(deps = {}) {
  const env = deps.env ?? process.env;
  return {
    env,
    base: routerGatewayUrl(env),
    headers: { ...routerHeaders(env), ...(deps.headers ?? {}) },
    fetch: deps.fetch ?? globalThis.fetch,
    sleep: deps.sleep ?? defaultSleep,
    now: deps.now ?? Date.now,
    intervalMs: deps.intervalMs ?? MEDIA_POLL_INTERVAL_MS,
  };
}

function mediaIdempotencyKey(callId) {
  const stable = String(callId ?? "").trim() || randomUUID();
  return `lares-${createHash("sha256").update(stable).digest("hex")}`;
}

/** @returns {Promise<Record<string, any>>} the created generation, carrying its id. */
export async function submitMediaGeneration(request, deps = {}) {
  const t = transport(deps);
  const stamped = withSref(request.body, routerEndUser(t.env), t.env);
  let body = Buffer.from(JSON.stringify(stamped), "utf8");
  if (carriesWebpImage(body)) body = await transcodeWebpImages(body);
  const response = await t.fetch(`${t.base}/${request.route}`, {
    method: "POST",
    headers: {
      ...t.headers,
      "content-type": "application/json",
      prefer: "respond-async",
      ...(deps.idempotencyKey ? {
        "idempotency-key": deps.idempotencyKey,
        "x-olares-idempotency-key": deps.idempotencyKey,
      } : {}),
    },
    body,
    signal: deps.signal,
  });
  const payload = await readJson(response);
  if (!response.ok) throw errorFromResponse(response, payload, "");
  const id = String(payload?.id ?? "").trim();
  if (!id) throw new MediaGenerationError("Router accepted the generation without an id");
  return payload;
}

/**
 * Poll one generation until it settles.
 *
 * A dropped connection or a busy Router is not the generation failing: it keeps
 * running upstream and has already been paid for, so transient failures wait
 * and retry rather than end the call. Only a settled status, a 404, or a
 * refusal ends it.
 */
export async function awaitMediaGeneration(id, deps = {}) {
  const t = transport(deps);
  const deadline = t.now() + (deps.timeoutMs ?? MEDIA_GENERATION_TIMEOUT_MS);
  let transient = 0;
  for (;;) {
    let wait = t.intervalMs;
    try {
      const response = await t.fetch(`${t.base}/generations/${encodeURIComponent(id)}`, {
        headers: t.headers,
        signal: deps.signal,
      });
      const payload = await readJson(response);
      if (response.ok) {
        transient = 0;
        const status = String(payload?.status ?? "").toLowerCase();
        if (TERMINAL.has(status)) return payload;
        deps.onProgress?.(payload);
      } else {
        const error = errorFromResponse(response, payload, id);
        if (!error.retryable && response.status < 500) throw error;
        transient += 1;
        if (transient > MAX_TRANSIENT_FAILURES) throw error;
        wait = Math.max(wait, error.retryAfterSeconds * 1000);
      }
    } catch (error) {
      if (deps.signal?.aborted || error instanceof MediaGenerationError) throw error;
      transient += 1;
      if (transient > MAX_TRANSIENT_FAILURES) throw error;
    }
    if (t.now() + wait > deadline) {
      throw new MediaGenerationError(`generation ${id} did not settle in time; it may still finish`, { id });
    }
    await t.sleep(wait, deps.signal);
  }
}

/** One poll, for a generation this process is not already waiting on. */
export async function peekMediaGeneration(id, deps = {}) {
  const t = transport(deps);
  const response = await t.fetch(`${t.base}/generations/${encodeURIComponent(id)}`, {
    headers: t.headers,
    signal: deps.signal,
  });
  const payload = await readJson(response);
  if (!response.ok) throw errorFromResponse(response, payload, id);
  return payload;
}

const OUTPUT_EXTENSIONS = Object.freeze({
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/flac": ".flac",
  "model/gltf-binary": ".glb",
});

async function downloadOutput(id, output, index, workspaceRoot, deps) {
  const t = transport(deps);
  const query = output?.id ? `?outputId=${encodeURIComponent(output.id)}` : "";
  const response = await t.fetch(`${t.base}/generations/${encodeURIComponent(id)}/content${query}`, {
    headers: t.headers,
    signal: deps.signal,
  });
  if (!response.ok) throw errorFromResponse(response, await readJson(response), id);
  const type = String(response.headers.get("content-type") ?? output?.content_type ?? "")
    .split(";", 1)[0].trim().toLowerCase();
  const extension = OUTPUT_EXTENSIONS[type] ?? ".bin";
  const destination = `outputs/${id}-${index + 1}${extension}`;
  const root = await resolveWorkspaceRoot(workspaceRoot);
  const absolute = await (deps.prepareTarget ?? prepareWorkspaceTarget)(root, destination, true);
  await (deps.writeFile ?? writeFile)(absolute, Buffer.from(await response.arrayBuffer()));
  return destination;
}

/**
 * Where each output of a completed generation can be opened, in output order:
 * its files address when the provider stored it on the user's drive, otherwise
 * a copy under the session workspace's outputs/ fetched through Router.
 */
export async function settledFiles(payload, workspaceRoot, deps = {}) {
  const env = deps.env ?? process.env;
  const enriched = await attachFlowstudioFilesPaths(payload, routerEndUser(env), {
    signal: deps.signal,
    cat: deps.cat,
  });
  const outputs = Array.isArray(enriched?.outputs) ? enriched.outputs : [];
  const files = [];
  for (const [index, output] of outputs.entries()) {
    const address = String(output?.files_path ?? "").trim();
    files.push(address || await downloadOutput(String(enriched.id ?? payload.id), output, index, workspaceRoot, deps));
  }
  return files;
}

/**
 * Generations this session submitted and never recorded as settled. The ledger
 * is what lets a result reach the user after the turn that asked for it ended
 * early — a model request failing after a nine-minute render, a cancel, a
 * restart — instead of only living in the tool call that was waiting on it.
 */
export function pendingMediaGenerations(events) {
  const pending = new Map();
  for (const event of events ?? []) {
    if (event?.type === MEDIA_SUBMITTED_EVENT && event.data?.id) {
      pending.set(String(event.data.id), { ...event.data });
    } else if (event?.type === MEDIA_SETTLED_EVENT && event.data?.id) {
      pending.delete(String(event.data.id));
    }
  }
  return [...pending.values()];
}

/** @returns {Record<string, unknown>} the settled ledger entry for a final payload or error. */
export function settledRecord(id, outcome) {
  if (outcome instanceof Error) {
    return {
      id,
      status: "failed",
      error: outcome.message,
      ...(outcome instanceof MediaGenerationError && outcome.code ? { code: outcome.code } : {}),
    };
  }
  return { id, status: outcome.status, files: outcome.files ?? [] };
}

function appendPresented(session, turn, callId, files) {
  if (files.length === 0 || turn === undefined || turn === null) return;
  session.append("deliverables/presented", { turn, callId, files: files.map((path) => ({ path })) });
}

/**
 * Settle what the ledger still lists as pending, presenting finished outputs
 * in the current turn. A generation that cannot be checked right now stays
 * pending and is left out of the result, so an unreachable Router does not
 * turn into a note every turn.
 */
export async function recoverMediaGenerations(session, { turn, workspaceRoot }, deps = {}) {
  const recovered = [];
  for (const entry of pendingMediaGenerations(session?.events)) {
    let payload;
    try {
      payload = await peekMediaGeneration(entry.id, deps);
    } catch (error) {
      if (deps.signal?.aborted) throw error;
      if (error instanceof MediaGenerationError && error.status === 404) {
        const gone = new MediaGenerationError("the generation has expired or no longer exists", error);
        session.append(MEDIA_SETTLED_EVENT, settledRecord(entry.id, gone));
        recovered.push({ ...entry, status: "failed", error: gone.message });
      }
      continue;
    }
    const status = String(payload?.status ?? "").toLowerCase();
    if (!TERMINAL.has(status)) {
      recovered.push({ ...entry, pending: true });
      continue;
    }
    if (status !== "completed") {
      const failure = generationFailure(payload);
      session.append(MEDIA_SETTLED_EVENT, settledRecord(entry.id, failure));
      recovered.push({ ...entry, status, error: failure.message });
      continue;
    }
    const files = await settledFiles(payload, workspaceRoot, deps);
    session.append(MEDIA_SETTLED_EVENT, settledRecord(entry.id, { status, files }));
    appendPresented(session, turn, `media-recovered-${entry.id}`, files);
    recovered.push({ ...entry, status, files });
  }
  return recovered;
}

/**
 * The skill passes images as `reference_images`. A FlowStudio row names those
 * files as parameter slots, so an unfilled image slot takes the next path and
 * the slot copy into Home/FlowStudio does the rest. Paths already in params
 * stay put. Leftover paths stay `reference_images` for a row with no slot.
 */
function placeReferenceImages(contract, args) {
  const paths = Array.isArray(args?.reference_images)
    ? args.reference_images.map((path) => String(path ?? "").trim()).filter(Boolean)
    : [];
  const params = args?.params && typeof args.params === "object" && !Array.isArray(args.params)
    ? { ...args.params }
    : {};
  const open = mediaSlots(contract).filter((slot) => (
    (slot.media === "image" || slot.type === "image") && (params[slot.key] == null || params[slot.key] === "")
  ));
  let used = 0;
  for (const slot of open) {
    if (used >= paths.length) break;
    params[slot.key] = paths[used];
    used += 1;
  }
  return { ...args, params, reference_images: paths.slice(used) };
}

/**
 * Run one generation to completion inside a tool call: submit (or pick up an
 * id an earlier turn submitted), record it in the session ledger before
 * waiting, and settle the ledger with what came back. A wait that is aborted
 * or times out leaves the entry pending for {@link recoverMediaGenerations}.
 */
export async function runMediaGeneration(args, { session, callId, workspaceRoot, signal }, deps = {}) {
  const resumeId = String(args?.generation_id ?? "").trim();
  let id = resumeId;
  let model = String(args?.model ?? "").trim();
  let mode = "";
  if (!resumeId) {
    if (!model.includes("/")) throw new MediaGenerationError("model must be <provider>/<model> as the catalog lists it");
    const contract = rowContract(await fetchCatalogRow(model, { ...deps, signal }));
    const placed = placeReferenceImages(contract, args);
    const paths = Array.isArray(placed.reference_images) ? placed.reference_images : [];
    const images = [];
    for (const path of paths) images.push(await referenceImageDataUrl(workspaceRoot, path));
    const maskPath = String(placed.mask_image ?? "").trim();
    const maskImageDataUrl = maskPath
      ? await referenceImageDataUrl(workspaceRoot, maskPath)
      : "";
    const params = await slotParams(contract, placed.params, workspaceRoot, deps.env ?? process.env, deps);
    const request = mediaGenerationRequest(
      contract,
      { ...placed, ...(params === undefined ? {} : { params }), mask_image_data_url: maskImageDataUrl },
      images,
    );
    const created = await submitMediaGeneration(request, {
      ...deps,
      signal,
      idempotencyKey: mediaIdempotencyKey(callId),
    });
    id = String(created.id);
    model = request.body.model;
    mode = request.mode;
  }
  const known = pendingMediaGenerations(session?.events).some((entry) => entry.id === id);
  if (!known) session?.append(MEDIA_SUBMITTED_EVENT, { id, model, mode, callId });

  let final;
  try {
    final = await awaitMediaGeneration(id, { ...deps, signal });
  } catch (error) {
    if (signal?.aborted || !(error instanceof MediaGenerationError) || error.status !== 404) throw error;
    session?.append(MEDIA_SETTLED_EVENT, settledRecord(id, error));
    throw error;
  }
  const status = String(final?.status ?? "").toLowerCase();
  if (status !== "completed") {
    const failure = generationFailure(final);
    session?.append(MEDIA_SETTLED_EVENT, settledRecord(id, failure));
    throw failure;
  }
  const files = await settledFiles(final, workspaceRoot, { ...deps, signal });
  session?.append(MEDIA_SETTLED_EVENT, settledRecord(id, { status, files }));
  return { id, status, files };
}

/** Model-facing note about generations recovered at the start of a turn. */
export function recoveredGenerationsNote(recovered) {
  if (recovered.length === 0) return "";
  const lines = recovered.map((item) => {
    if (item.files?.length) {
      return `- ${item.id} (${item.model ?? "media"}) finished and is now presented: ${item.files.map((path) => `\`${path}\``).join(", ")}`;
    }
    if (item.pending) {
      return `- ${item.id} (${item.model ?? "media"}) is still running; call media_generate with generation_id "${item.id}" to wait for it`;
    }
    return `- ${item.id} (${item.model ?? "media"}) ended without output: ${item.error ?? item.status}`;
  });
  return [
    "Media generations started in an earlier turn were checked before this one:",
    ...lines,
    "Mention a finished one to the user if it is what they were waiting for; do not generate it again.",
  ].join("\n");
}
