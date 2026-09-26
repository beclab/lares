import { producedEditCard } from "../drive/execute.js";
import { workspaceRootFromSession } from "../workspace/env.js";
import {
  MEDIA_GENERATION_ROUTES,
  MEDIA_GENERATION_TIMEOUT_MS,
  runMediaGeneration,
} from "./generation.js";

export const MEDIA_GENERATE_TOOL = "media_generate";

export const MEDIA_GENERATE_PROMPT = [
  "Generate images, video, music, and 3D with media_generate, not with curl and a sleep loop.",
  "It submits through Router as the logged-in user, waits for the result, and publishes every",
  "output itself, so do not workspace_publish or download its files again. Pick model and mode",
  "from one catalog row; put only fields that row's canonical_fields names into options.",
  "If a turn ended before a generation finished, the next turn is told; resume it with",
  "generation_id instead of generating it again.",
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
        description: "<provider>/<model> exactly as the catalog row lists it. Required unless generation_id is set.",
      },
      mode: {
        type: "string",
        enum: Object.keys(MEDIA_GENERATION_ROUTES),
        description: "The catalog row's mode; it decides the Router route. Required unless generation_id is set.",
      },
      prompt: {
        type: "string",
        description: "The user's prompt, unchanged.",
      },
      reference_images: {
        type: "array",
        items: { type: "string" },
        description: "Workspace-relative image paths (png, jpeg, webp, gif) to condition on: I2V, R2V, image edit.",
      },
      options: {
        type: "object",
        description:
          "Extra request fields the row's canonical_fields names, e.g. {\"seed\": 7}."
          + " Omit seed for a fresh result.",
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
    : `${String(args?.mode ?? "media").replace(/_generation$/, "")} with ${String(args?.model ?? "")}`;
  return producedEditCard(`Generate ${target}`.slice(0, 160));
}
