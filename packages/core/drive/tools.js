import {
  executeDriveFetch,
  executeFfmpegEncode,
  executeUrlFetch,
  executeWorkspacePublish,
  presentDriveFetch,
  presentFfmpegEncode,
  presentUrlFetch,
  presentWorkspacePublish,
} from "./execute.js";
import { DRIVE_TRANSFER_TIMEOUT_MS } from "./paths.js";

export function driveFetchDefinition(download) {
  return {
    name: "drive_fetch",
    description:
      "Copy one file from the Olares files backend (drive/…, sync/…, external/…, cloud accounts) into"
      + " the session workspace when a later edit or transcode needs it there. Preview of a files path"
      + " does not require this — workspace_publish the drive/… path instead. Size is not a reason to skip.",
    parameters: {
      path: {
        type: "string",
        required: true,
        description: "Olares files path of a single file, e.g. drive/Home/Documents/clip.webm.",
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
  };
}

export function urlFetchDefinition(download) {
  return {
    name: "url_fetch",
    description:
      "Download one public HTTP(S) URL, or a data: URL / base64 payload, into the session workspace"
      + " and publish it for preview. This is the default for a pasted or requested online file; do"
      + " not answer with only the URL. Use after web search, or when olares-cli router / FlowStudio"
      + " returns a URL or inline bytes. Size is not a reason to skip.",
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
  };
}

export function workspacePublishDefinition(statFile) {
  return {
    name: "workspace_publish",
    description:
      "Publish one existing file as a produced artifact so the UI can preview it. Path is either"
      + " workspace-relative or an Olares files path (drive/Home/Documents/clip.webm). After knowledge"
      + " / Wise / yt-dlp lands in Files, call this immediately on that drive/… path — the user does"
      + " not need to request preview. Also use after a skill writes a local file. Do not use it after"
      + " drive_fetch, url_fetch, or ffmpeg_encode, which already publish.",
    parameters: {
      path: {
        type: "string",
        required: true,
        description:
          "Workspace-relative path of one existing regular file, or an Olares files path such as"
          + " drive/Home/Documents/clip.webm.",
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
    execute: (args, exec) => executeWorkspacePublish(args, exec, statFile),
    presentCall: presentWorkspacePublish,
  };
}

export function ffmpegEncodeDefinition(encode) {
  return {
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
  };
}
