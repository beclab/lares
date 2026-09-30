import { routerGatewayUrl, routerHeaders } from "../router/gateway.js";

/**
 * The Router catalog row decides a generation's contract: which route it takes,
 * whether it edits, which media it needs, and which parameters it accepts.
 * FlowStudio publishes that per workflow (param schema, reference / mask needs,
 * operations) and Router carries it on `/models?detail=capabilities`, so the
 * tool reads it at call time instead of hard-coding any of it.
 */

/** Row mode → Router route for the family's default generation. */
export const MEDIA_GENERATION_ROUTES = Object.freeze({
  image_generation: "images/generations",
  video_generation: "videos",
  music_generation: "music/generations",
  model3d_generation: "generations",
});

const IMAGE_FIELDS = new Set(["inputs.images", "reference_images", "input_images", "inputImages"]);
const MASK_FIELDS = new Set(["inputs.mask", "mask_image", "maskImage"]);

export class MediaContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "MediaContractError";
  }
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function fieldName(field) {
  if (typeof field === "string") return field.trim();
  if (field && typeof field === "object") return String(field.name ?? field.field ?? field.key ?? "").trim();
  return "";
}

function flag(...values) {
  for (const value of values) if (typeof value === "boolean") return value;
  return undefined;
}

function option(entry) {
  if (entry && typeof entry === "object") {
    const value = entry.value ?? entry.id ?? entry.label;
    return { value, label: String(entry.label ?? entry.name ?? value ?? "") };
  }
  return { value: entry, label: String(entry ?? "") };
}

/** One declared parameter, whatever spelling Router used for its attributes. */
function parameter(entry) {
  if (!entry || typeof entry !== "object") return null;
  const key = String(entry.key ?? entry.name ?? "").trim();
  if (!key) return null;
  return {
    key,
    label: String(entry.label ?? key),
    type: String(entry.type ?? "").trim().toLowerCase(),
    required: entry.required === true,
    default: entry.default,
    min: typeof entry.min === "number" ? entry.min : undefined,
    max: typeof entry.max === "number" ? entry.max : undefined,
    options: list(entry.options).map(option),
    role: String(entry.associateRole ?? "").trim(),
    // A media slot FlowStudio exported: what it takes and how its value is written.
    media: String(entry.media ?? "").trim(),
    valueFormat: String(entry.valueFormat ?? "").trim(),
  };
}

/**
 * The contract of one catalog row.
 * @returns {{
 *   id: string, name: string, mode: string, enabled: boolean,
 *   operations: string[], parameters: ReturnType<typeof parameter>[],
 *   images: "required" | "accepted" | "none" | "unknown",
 *   mask: "required" | "accepted" | "none" | "unknown",
 * }}
 */
export function rowContract(row) {
  const flowstudio = row?.flowstudio && typeof row.flowstudio === "object" ? row.flowstudio : null;
  const canonical = new Set(list(row?.canonical_fields ?? row?.canonicalFields).map(fieldName).filter(Boolean));
  const operations = list(row?.creative?.operations ?? row?.operations)
    .map((op) => String(op ?? "").trim().toLowerCase())
    .filter(Boolean);
  const needsReference = flag(flowstudio?.needs_reference, flowstudio?.needsReference, row?.needs_reference);
  const needsMask = flag(flowstudio?.needs_mask, flowstudio?.needsMask, row?.needs_mask);
  const takesImages = [...canonical].some((name) => IMAGE_FIELDS.has(name)) || operations.includes("edit");
  const takesMask = [...canonical].some((name) => MASK_FIELDS.has(name));
  // A row FlowStudio described says outright what it needs; for any other row
  // silence is not a refusal, so the tool leaves the decision to Router.
  const described = needsReference !== undefined || flowstudio !== null || canonical.size > 0;
  // Router states it per row: a row that only edits (image edit, I2V, upscale)
  // cannot run without its source, whatever family it belongs to.
  const editOnly = operations.length > 0 && operations.includes("edit") && !operations.includes("generate");
  const need = (required, accepted) => {
    if (required === true) return "required";
    if (accepted) return "accepted";
    return described ? "none" : "unknown";
  };
  return {
    id: String(row?.id ?? "").trim(),
    name: String(row?.name ?? row?.id ?? "").trim(),
    mode: String(row?.mode ?? "").trim().toLowerCase(),
    enabled: row?.enabled !== false && row?.disabled !== true,
    operations,
    parameters: list(flowstudio?.parameters).map(parameter).filter(Boolean),
    images: need(needsReference ?? (editOnly && takesImages ? true : undefined), takesImages),
    mask: need(needsMask, takesMask),
  };
}

/** The media slots a FlowStudio row exports among its parameters. */
export function mediaSlots(contract) {
  return contract.parameters.filter((p) => p.media);
}

/** The key FlowStudio marked as this workflow's prompt (`associateRole: "prompt"`), if any. */
export function promptParameterKey(contract) {
  return contract.parameters.find((p) => p.role === "prompt")?.key ?? "";
}

/** Compact "key (label, type, range / options)" list for a model-facing error. */
export function describeParameters(parameters) {
  if (parameters.length === 0) return "this row declares no parameters";
  return parameters.map((p) => {
    const facts = [p.label !== p.key ? p.label : "", p.type].filter(Boolean);
    if (p.min !== undefined || p.max !== undefined) facts.push(`${p.min ?? "…"}–${p.max ?? "…"}`);
    if (p.options.length > 0) facts.push(`one of ${p.options.map((o) => JSON.stringify(o.value)).join(", ")}`);
    if (p.default !== undefined) facts.push(`default ${JSON.stringify(p.default)}`);
    if (p.role === "prompt") facts.push("the prompt");
    if (p.media) facts.push(`${p.media} slot: ${p.valueFormat || "filesPath"}`);
    if (p.required) facts.push("required");
    return facts.length ? `${p.key} (${facts.join(", ")})` : p.key;
  }).join("; ");
}

/**
 * Check caller params against the row's `flowstudio.parameters` and return
 * them unchanged for `flowstudio.params`. FlowStudio owns this vocabulary: the
 * only rule here is that every key is one it declared. Values are never
 * converted, clamped, or mapped — FlowStudio validates what it receives.
 */
export function bindParams(contract, params = {}) {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw new MediaContractError("params must be an object keyed by the row's flowstudio.parameters keys");
  }
  const declared = new Set(contract.parameters.map((p) => p.key));
  for (const key of Object.keys(params)) {
    if (!declared.has(key)) {
      throw new MediaContractError(
        `params.${key} is not a parameter of ${contract.name || contract.id}; it accepts: ${describeParameters(contract.parameters)}`,
      );
    }
  }
  return { ...params };
}

/**
 * Route, operation, and media placement for one submission, all from the row.
 * @returns {{ route: string, operation: string, canonical: boolean }}
 */
export function planGeneration(contract, { images = 0, mask = false, slotMedia = false } = {}) {
  const released = MEDIA_GENERATION_ROUTES[contract.mode];
  if (!released) {
    throw new MediaContractError(`${contract.id} is a ${contract.mode || "unknown"} row, not an image, video, music, or 3D generation`);
  }
  if (!contract.enabled) throw new MediaContractError(`${contract.id} is disabled in the Router catalog`);
  const slots = mediaSlots(contract);
  if (slots.length > 0) {
    // FlowStudio names every media input as a slot and checks them itself.
    if (images > 0 || mask) {
      throw new MediaContractError(
        `${contract.name || contract.id} takes its media in params by slot: ${describeParameters(slots)}`,
      );
    }
    const ops = contract.operations;
    const edits = ops.includes("edit") && (!ops.includes("generate") || slotMedia);
    const operation = contract.mode === "image_generation" && edits ? "edit" : "";
    return {
      route: operation === "edit" ? "generations" : released,
      operation,
      canonical: operation === "edit",
      // Router refuses an edit row without inputs.images, and a required editMask
      // without inputs.mask, before it forwards. These placeholders only pass
      // that check; FlowStudio ignores them once the slots are in params.
      passCheck: {
        images: ops.includes("edit") && !ops.includes("generate"),
        mask: slots.some((p) => p.type === "editmask" && p.required),
      },
    };
  }
  if (contract.images === "required" && images === 0) {
    throw new MediaContractError(`${contract.name || contract.id} needs a source image in reference_images`);
  }
  if (contract.images === "none" && images > 0) {
    throw new MediaContractError(`${contract.name || contract.id} takes no reference image; pick a row that edits or animates one`);
  }
  if (contract.mask === "required" && !mask) {
    throw new MediaContractError(`${contract.name || contract.id} needs a mask in mask_image`);
  }
  if (contract.mask === "none" && mask) {
    throw new MediaContractError(`${contract.name || contract.id} takes no mask`);
  }
  const ops = contract.operations;
  let operation = "";
  if (contract.mode === "image_generation") {
    if (images > 0) {
      if (ops.length > 0 && !ops.includes("edit")) {
        throw new MediaContractError(`${contract.name || contract.id} does not edit images (operations: ${ops.join(", ")})`);
      }
      operation = "edit";
    } else if (ops.length > 0 && !ops.includes("generate")) {
      throw new MediaContractError(`${contract.name || contract.id} only ${ops.join(", ")}s; it needs a source image in reference_images`);
    }
  }
  const canonical = operation === "edit";
  return { route: canonical ? "generations" : released, operation, canonical, passCheck: { images: false, mask: false } };
}

/** Read one row from Router's catalog as the logged-in user. */
export async function fetchCatalogRow(model, deps = {}) {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const response = await fetchImpl(`${routerGatewayUrl(env)}/models?detail=capabilities`, {
    headers: { ...routerHeaders(env), ...(deps.headers ?? {}) },
    signal: deps.signal,
  });
  if (!response.ok) {
    throw new MediaContractError(`Router catalog answered HTTP ${response.status}; cannot check ${model}`);
  }
  let payload;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw new MediaContractError("Router catalog did not answer JSON");
  }
  const rows = list(payload?.data ?? payload?.items);
  const row = rows.find((item) => String(item?.id ?? "").trim() === model);
  if (!row) throw new MediaContractError(`${model} is not in the Router catalog; list the family again and pick a listed row`);
  return row;
}
