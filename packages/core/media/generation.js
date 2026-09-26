import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { attachFlowstudioFilesPaths } from "../drive/flowstudio-files.js";
import { routerEndUser, routerGatewayUrl, routerHeaders } from "../router/gateway.js";
import {
  prepareWorkspaceTarget,
  resolveExistingWorkspacePath,
  resolveWorkspaceRoot,
  workspaceCandidate,
} from "../workspace/path.js";
import { carriesWebpImage, transcodeWebpImages } from "./router-images.js";

/** Catalog mode → Router data-plane route that creates a generation of it. */
export const MEDIA_GENERATION_ROUTES = Object.freeze({
  image_generation: "images/generations",
  video_generation: "videos",
  music_generation: "music/generations",
  model3d_generation: "generations",
});

/** A long video on a busy local GPU has been measured at nine minutes. */
export const MEDIA_GENERATION_TIMEOUT_MS = 60 * 60 * 1000;
export const MEDIA_POLL_INTERVAL_MS = 5_000;
const MAX_REFERENCE_IMAGES = 4;
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const MAX_TRANSIENT_FAILURES = 12;
const RESERVED_OPTION_KEYS = new Set(["model", "prompt", "reference_images", "inputs", "operation"]);

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
 * Reference images are read from the session workspace and sent as data URLs:
 * the upstream cannot read a path on this pod, and the one spelling every
 * Router media route accepts is `reference_images`.
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

/** @returns {{ mode: string, route: string, body: Record<string, unknown> }} */
export function mediaGenerationRequest(args, referenceImages = []) {
  const mode = String(args?.mode ?? "").trim();
  const route = MEDIA_GENERATION_ROUTES[mode];
  if (!route) {
    throw new MediaGenerationError(
      `mode must be one of ${Object.keys(MEDIA_GENERATION_ROUTES).join(", ")}`,
    );
  }
  const model = String(args?.model ?? "").trim();
  if (!model.includes("/")) throw new MediaGenerationError("model must be <provider>/<model> as the catalog lists it");
  const prompt = String(args?.prompt ?? "");
  if (referenceImages.length > MAX_REFERENCE_IMAGES) {
    throw new MediaGenerationError(`at most ${MAX_REFERENCE_IMAGES} reference images`);
  }
  const options = args?.options && typeof args.options === "object" && !Array.isArray(args.options)
    ? args.options
    : {};
  const body = {};
  for (const [key, value] of Object.entries(options)) {
    if (RESERVED_OPTION_KEYS.has(key)) {
      throw new MediaGenerationError(`options.${key} is set by the tool itself`);
    }
    body[key] = value;
  }
  body.model = model;
  if (prompt) body.prompt = prompt;
  if (referenceImages.length > 0) body.reference_images = referenceImages;
  return { mode, route, body };
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

function errorFromResponse(response, payload, id) {
  const error = payload?.error && typeof payload.error === "object" ? payload.error : {};
  const code = String(error.code ?? error.type ?? "").trim();
  const message = String(error.message ?? payload?.error ?? `Router answered HTTP ${response.status}`);
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
  const code = String(payload?.error_code ?? payload?.error?.code ?? "").trim();
  const text = typeof payload?.error === "string"
    ? payload.error
    : String(payload?.error?.message ?? "");
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

/** @returns {Promise<Record<string, any>>} the created generation, carrying its id. */
export async function submitMediaGeneration(request, deps = {}) {
  const t = transport(deps);
  let body = Buffer.from(JSON.stringify(request.body), "utf8");
  if (carriesWebpImage(body)) body = await transcodeWebpImages(body);
  const response = await t.fetch(`${t.base}/${request.route}`, {
    method: "POST",
    headers: { ...t.headers, "content-type": "application/json", prefer: "respond-async" },
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
 * Run one generation to completion inside a tool call: submit (or pick up an
 * id an earlier turn submitted), record it in the session ledger before
 * waiting, and settle the ledger with what came back. A wait that is aborted
 * or times out leaves the entry pending for {@link recoverMediaGenerations}.
 */
export async function runMediaGeneration(args, { session, callId, workspaceRoot, signal }, deps = {}) {
  const resumeId = String(args?.generation_id ?? "").trim();
  let id = resumeId;
  let model = String(args?.model ?? "").trim();
  let mode = String(args?.mode ?? "").trim();
  if (!resumeId) {
    const paths = Array.isArray(args?.reference_images) ? args.reference_images : [];
    const images = [];
    for (const path of paths) images.push(await referenceImageDataUrl(workspaceRoot, path));
    const request = mediaGenerationRequest(args, images);
    const created = await submitMediaGeneration(request, { ...deps, signal });
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
