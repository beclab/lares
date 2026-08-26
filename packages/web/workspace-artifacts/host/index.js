import { defineTool } from "@deepseek-ai/dsh-tools";
import {
  executeDriveFetch,
  executeFfmpegEncode,
  executeUrlFetch,
  executeWorkspacePublish,
  presentDriveFetch,
  presentFfmpegEncode,
  presentUrlFetch,
  presentWorkspacePublish,
} from "@lares/core/drive/execute";
import {
  DRIVE_IMPORT_PROMPT,
  DRIVE_TRANSFER_TIMEOUT_MS,
} from "@lares/core/drive/paths";

export const name = "lares-workspace-artifacts";
export const inject = ["tools", "systemPrompt"];

/** @param download - seam for tests; the real olares-cli download otherwise. */
export function createFetchTool(download) {
  return defineTool({
    name: "drive_fetch",
    description:
      "Copy one file from the Olares files backend (drive/…, sync/…, external/…, cloud accounts) into"
      + " the session workspace, where it can be read, edited, and opened by the user.",
    parameters: {
      path: {
        type: "string",
        required: true,
        description: "Olares files path of a single file, e.g. drive/Home/Downloads/clip.webm.",
      },
      destination: {
        type: "string",
        description:
          "Workspace-relative target. A trailing slash names a directory to fetch into;"
          + " omit to use downloads/ and the source file name.",
      },
      overwrite: {
        type: "boolean",
        description: "Replace an existing destination file. Without it an existing path fails the call.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", required: true },
          bytes: { type: "integer", required: true },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: `Fetched ${args.path} into ${value.path} (${value.bytes} bytes).`,
      }],
    },
    timeoutMs: DRIVE_TRANSFER_TIMEOUT_MS,
    execute: (args, exec) => executeDriveFetch(args, exec, download),
    presentCall: presentDriveFetch,
  });
}

export function createUrlFetchTool(download) {
  return defineTool({
    name: "url_fetch",
    description:
      "Download one public HTTP(S) URL, or a data: URL / base64 payload, into the session workspace."
      + " Use after web search for online files, or when olares-cli router / FlowStudio returns a URL or"
      + " inline bytes; unlike curl/wget, this reports the file as a produced artifact so the user can"
      + " open or preview it.",
    parameters: {
      url: {
        type: "string",
        required: true,
        description: "Direct public HTTP(S) file URL, or a data: URL (wrap raw base64 as data:<mediaType>;base64,...). Private/internal hosts and unsafe redirects are refused.",
      },
      destination: {
        type: "string",
        description:
          "Workspace-relative target path. Required with a meaningful extension when the URL path"
          + " has none, e.g. downloads/portrait.jpg.",
      },
      overwrite: {
        type: "boolean",
        description: "Replace an existing destination file. Without it an existing path fails the call.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", required: true },
          bytes: { type: "integer", required: true },
          mediaType: { type: "string", required: true },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: `Downloaded ${value.path} (${value.bytes} bytes, ${value.mediaType}).`,
      }],
    },
    timeoutMs: DRIVE_TRANSFER_TIMEOUT_MS,
    execute: (args, exec) => executeUrlFetch(args, exec, download),
    presentCall: presentUrlFetch,
  });
}

export function createWorkspacePublishTool() {
  return defineTool({
    name: "workspace_publish",
    description:
      "Publish one file that already exists in the session workspace as a produced artifact. Use after"
      + " olares-cli router, FlowStudio, a skill, or another shell process writes an image, audio, or"
      + " other final file locally; this makes the UI open or preview it. Do not use it after"
      + " ffmpeg_encode, which already publishes the video.",
    parameters: {
      path: {
        type: "string",
        required: true,
        description: "Exact workspace-relative path of one existing regular file.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", required: true },
          bytes: { type: "integer", required: true },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: `Published ${value.path} (${value.bytes} bytes).`,
      }],
    },
    execute: executeWorkspacePublish,
    presentCall: presentWorkspacePublish,
  });
}

export function createFfmpegEncodeTool(encode) {
  return defineTool({
    name: "ffmpeg_encode",
    description:
      "Generate, transcode, or burn subtitles into one H.264 video in the session workspace and publish"
      + " it for preview."
      + " Use this instead of shell ffmpeg for ordinary encodes. The host uses libx264;"
      + " do not pass encoder flags.",
    parameters: {
      destination: {
        type: "string",
        description:
          "Workspace-relative browser-previewable .mp4 output. Omit to use outputs/<name>.mp4.",
      },
      input: {
        type: "string",
        description: "Workspace-relative video to transcode. Mutually exclusive with pattern.",
      },
      subtitles: {
        type: "string",
        description:
          "Workspace-relative .srt, .vtt, .ass, or .ssa file to burn into input."
          + " Requires input; the host supplies a readable CJK-capable style.",
      },
      pattern: {
        type: "string",
        description: "Synthetic source testsrc2. Mutually exclusive with input.",
      },
      duration: {
        type: "number",
        description: "Seconds to write. Required for pattern; optional trim for input.",
      },
      width: {
        type: "integer",
        description: "Pattern frame width. Defaults to 1280.",
      },
      height: {
        type: "integer",
        description: "Pattern frame height. Defaults to 720.",
      },
      overwrite: {
        type: "boolean",
        description: "Replace an existing destination file. Without it an existing path fails the call.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", required: true },
          bytes: { type: "integer", required: true },
          encoder: { type: "string", required: true },
          speed: { type: "string", required: true },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: `Encoded ${value.path} with ${value.encoder}`
          + `${value.speed ? ` at ${value.speed}` : ""} (${value.bytes} bytes).`,
      }],
    },
    timeoutMs: DRIVE_TRANSFER_TIMEOUT_MS,
    execute: (args, exec) => executeFfmpegEncode(args, exec, encode),
    presentCall: presentFfmpegEncode,
  });
}

export function apply(ctx) {
  ctx.systemPrompt.section({ name: "tool:drive_fetch", order: 115, text: DRIVE_IMPORT_PROMPT });
  ctx.tools.register(createFetchTool());
  ctx.tools.register(createUrlFetchTool());
  ctx.tools.register(createWorkspacePublishTool());
  ctx.tools.register(createFfmpegEncodeTool());
}
