import { producedEditCard } from "../drive/execute.js";
import { workspaceRootFromSession } from "../workspace/env.js";
import { MEDIA_GENERATION_TIMEOUT_MS, runMediaGeneration } from "./generation.js";

export const MEDIA_GENERATE_TOOL = "media_generate";

export const MEDIA_GENERATE_PROMPT = [
  "Generate or edit images, video, music, and 3D with media_generate, not with curl and a sleep loop.",
  "Name the catalog row by model; the tool reads that row from Router and takes the route and",
  "the operation from it. For a FlowStudio row, every input the workflow takes goes in params",
  "under its flowstudio.parameters key, unchanged: the prompt (associateRole \"prompt\"), each",
  "control, and each media slot (an entry with media / valueFormat) as a file path. FlowStudio",
  "checks all of it; fix the call from its error once.",
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
        description:
          "The user's prompt, unchanged, for a row without flowstudio.parameters. A FlowStudio row"
          + " takes its prompt in params instead; omit this and the tool sends Router the"
          + " top-level copy it requires.",
      },
      reference_images: {
        type: "array",
        items: { type: "string" },
        description:
          "Only for a row whose parameters list no media slot (a cloud model): workspace images"
          + " to condition on. A FlowStudio row names its media slots in params instead.",
      },
      mask_image: {
        type: "string",
        description: "Only for a row whose parameters list no media slot: a workspace mask image.",
      },
      params: {
        type: "object",
        additionalProperties: true,
        description:
          "Every input a FlowStudio workflow takes, keyed exactly as the row's"
          + " flowstudio.parameters lists them, values unchanged; sent as flowstudio.params."
          + " The prompt goes under the associateRole \"prompt\" key. A media slot takes a file:"
          + " valueFormat filesPath is one path, filesPathBySlot is {option value: path},"
          + " sourceAndMask is {source, mask}. A path is a workspace file (the tool copies it to"
          + " Home/FlowStudio/uploads) or a drive/Home/FlowStudio/… address such as an earlier"
          + " output. Omit a parameter to keep its default.",
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
