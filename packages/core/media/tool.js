import { producedEditCard } from "../drive/execute.js";
import { workspaceRootFromSession } from "../workspace/env.js";
import { MEDIA_GENERATION_TIMEOUT_MS, runMediaGeneration } from "./generation.js";

export const MEDIA_GENERATE_TOOL = "media_generate";

export const MEDIA_GENERATE_PROMPT = [
  "Generate or edit images, video, music, and 3D with media_generate, not with curl and a sleep loop.",
  "Name the catalog row by model. Pass the user's prompt unchanged, images as reference_images",
  "(workspace paths) for an edit or I2V / R2V, an optional mask_image, and params for the row's",
  "tunables, keyed by flowstudio.parameters[].key. The tool reads the row and takes the route,",
  "the operation, and where each file goes. A supplied image on an image_generation row is an edit.",
  "It submits as the logged-in user, waits, and publishes every output itself: do not",
  "workspace_publish or download its files again. If a turn ended before a generation",
  "finished, resume it with generation_id instead of generating it again.",
].join(" ");

/** @param deps - seams for tests: fetch, sleep, env, cat. */
export function mediaGenerateDefinition(deps = {}) {
  return {
    name: MEDIA_GENERATE_TOOL,
    description:
      "Create one image, video, music, or 3D generation through Router and wait until it finishes."
      + " Every output is published for preview when the call returns. For image-to-video or an"
      + " image edit, pass the user's image as reference_images. Pass generation_id alone to wait"
      + " for a generation an earlier turn started.",
    parameters: {
      model: {
        type: "string",
        description:
          "<provider>/<model> exactly as the catalog row lists it. The row decides everything else"
          + " about the call. Required unless generation_id is set.",
      },
      prompt: {
        type: "string",
        description: "The user's prompt, unchanged.",
      },
      reference_images: {
        type: "array",
        items: { type: "string" },
        description:
          "Workspace image paths for an edit or I2V / R2V. The tool places them on the row.",
      },
      mask_image: {
        type: "string",
        description: "Optional workspace mask image.",
      },
      params: {
        type: "object",
        additionalProperties: true,
        description:
          "Tunables keyed by the row's flowstudio.parameters[].key. The tool sends them as"
          + " flowstudio.params. Match the user's words to each entry's label; for a select send"
          + " the option's value. A row without flowstudio.parameters takes no params.",
      },
      generation_id: {
        type: "string",
        description: "Resume waiting for this generation instead of starting a new one.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", required: true },
          status: { type: "string", required: true },
          files: { type: "array", items: { type: "string" }, required: true },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: `Generation ${value.id} ${value.status}; published ${value.files.join(", ") || "no files"}.`,
      }],
    },
    timeoutMs: MEDIA_GENERATION_TIMEOUT_MS,
    execute: (args, exec) => runMediaGeneration(args, {
      session: exec?.agent?.session,
      callId: exec?.callId,
      workspaceRoot: workspaceRootFromSession(exec, deps.env),
      signal: exec?.signal,
    }, deps),
    presentCall: presentMediaGenerate,
  };
}

export function presentMediaGenerate(args) {
  const target = String(args?.generation_id ?? "").trim()
    ? `generation ${args.generation_id}`
    : `media with ${String(args?.model ?? "")}`;
  return producedEditCard(`Generate ${target}`.slice(0, 160));
}
