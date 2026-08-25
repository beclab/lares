/**
 * Lares drive-import Host: `drive_fetch`, `url_fetch`, `workspace_publish`,
 * and `ffmpeg_encode`.
 *
 * A file in the user's Olares files backend, behind a URL, or written by a bare
 * shell command cannot be opened from the chat — the preview only serves the
 * session workspace, and dsh only learns of a produced file from a tool call
 * view declaring `kind: 'edit'` with `locations`. That declaration is what makes
 * the chip, the inline-code mention, and the conversation's media player appear,
 * so every route into the workspace goes through one of these tools.
 */
import { existsSync, statSync } from "node:fs";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { workspaceRootFromEnv } from "../../bundle-web/host/default-workspace.js";
import {
  ensureWorkspaceDirectory,
  resolveExistingWorkspacePath,
  resolveWorkspaceRoot,
  workspaceCandidate,
} from "../../shared/host/workspace-path.js";
import { runOlaresDownload } from "./download.js";
import {
  describeFetch,
  describeFfmpegEncode,
  describeUrlFetch,
  describeWorkspacePublish,
  resolveFetch,
  resolveFfmpegEncode,
  resolveUrlFetch,
  resolveWorkspacePublish,
} from "./paths.js";
import { encodeWorkspaceVideo } from "./ffmpeg-run.js";
import { downloadUrl, saveDataUrl } from "./url-download.js";

export const name = "lares-drive-import";
export const inject = ["tools", "systemPrompt"];

/** Media-sized transfers over the user's own link; well past the default budget. */
const TIMEOUT_MS = 30 * 60 * 1000;

const PROMPT = [
  "Olares files paths (drive/…, sync/…, external/…, and the cloud-account namespaces) live in the",
  "user's files backend, not in this workspace: they cannot be read, edited, or previewed in place,",
  "and a download task started through olares-cli knowledge lands there too.",
  "Use drive_fetch to copy one such file into the workspace whenever the user wants to open, preview,",
  "or work on it.",
  "When the user asks to find or download an online image, video, audio, document, or other URL, use",
  "web search to find a direct public HTTP(S) URL, then use url_fetch to copy it into the workspace;",
  "do not use curl, wget, or shell for that download. Give destination a meaningful filename with the",
  "correct extension whenever the URL path lacks one.",
  "Never bypass a url_fetch rejection or failure with curl, wget, shell, Python, Node, a browser, or",
  "another network client. In particular, a non-public host refusal is a security boundary: report that",
  "the URL cannot be fetched and ask for a public URL or Olares Files path instead of trying it directly.",
  "When olares-cli router, FlowStudio, a skill, or another workflow generates media, normalize its final",
  "output before replying: use url_fetch for a returned HTTP(S) URL or a data: URL / base64 payload",
  "(wrap raw base64 as data:<mediaType>;base64,...), drive_fetch for an Olares Files path, or",
  "workspace_publish when the output is already a file in this session workspace. Do not stop at a task",
  "id, expiring URL, or unregistered shell-created path. After a skill or another shell command creates",
  "or transforms a file that ffmpeg_encode does not cover, call workspace_publish for each final output,",
  "not temporary intermediates.",
  "Use ffmpeg_encode to generate or transcode H.264 video, including burning SRT, VTT, ASS, or SSA",
  "subtitles into an input video. It writes the file with libx264 and publishes it for preview.",
  "Do not run ffmpeg or ffprobe in the shell for those jobs, and do not call workspace_publish",
  "afterwards. Report the encoder and speed from the tool result.",
  "Name every returned workspace path in markdown inline code so the UI can open it. The conversation",
  "renders produced images, video, and audio right below the reply, so put those mentions in the closing",
  "sentences and end the reply there: never name a produced file mid-reply and then continue with more",
  "prose, alternatives, or follow-up questions, which would strand the player far below the path.",
].join(" ");

function workspaceRoot(exec) {
  const cwd = exec?.agent?.session?.header?.cwd ?? workspaceRootFromEnv();
  if (cwd === null || cwd === undefined) throw new Error("no session workspace to fetch into");
  return cwd;
}

/** @returns the absolute path the download writes, with its directory in place. */
async function prepareTarget(root, destination, overwrite) {
  const segments = destination.split("/");
  const { directory } = await ensureWorkspaceDirectory(root, segments.slice(0, -1));
  const absolutePath = workspaceCandidate(directory, segments.at(-1));
  if (!overwrite && existsSync(absolutePath)) {
    throw new Error(`${destination} already exists; pass overwrite or choose another destination`);
  }
  return absolutePath;
}

/** @param download - seam for tests; the real olares-cli download otherwise. */
export function createFetchTool(download = runOlaresDownload) {
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
    timeoutMs: TIMEOUT_MS,
    async execute(args, exec) {
      const { source, destination } = resolveFetch(args);
      const root = workspaceRoot(exec);
      const absolutePath = await prepareTarget(root, destination, args.overwrite === true);
      await download(source, absolutePath, {
        signal: exec.signal,
        overwrite: args.overwrite === true,
      });
      return { path: destination, bytes: statSync(absolutePath).size };
    },
    presentCall: (args) => {
      const fetched = describeFetch(args);
      return {
        card: "generic",
        kind: "edit",
        title: `Fetch ${fetched?.source ?? String(args.path ?? "")}`,
        ...(fetched === null ? {} : { locations: [{ path: fetched.destination }] }),
      };
    },
  });
}

export function createUrlFetchTool(download = downloadUrl) {
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
    timeoutMs: TIMEOUT_MS,
    async execute(args, exec) {
      const resolved = resolveUrlFetch(args);
      const root = workspaceRoot(exec);
      const absolutePath = await prepareTarget(root, resolved.destination, args.overwrite === true);
      const result = resolved.kind === "data"
        ? await saveDataUrl(String(args.url), absolutePath, { overwrite: args.overwrite === true })
        : await download(resolved.source, absolutePath, {
          signal: exec.signal,
          overwrite: args.overwrite === true,
        });
      return { path: resolved.destination, bytes: result.bytes, mediaType: result.mediaType };
    },
    presentCall: (args) => {
      const fetched = describeUrlFetch(args);
      return {
        card: "generic",
        kind: "edit",
        title: fetched?.kind === "data"
          ? `Save ${fetched.destination}`
          : `Download ${fetched?.source ?? String(args.url ?? "").slice(0, 160)}`,
        ...(fetched === null ? {} : { locations: [{ path: fetched.destination }] }),
      };
    },
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
    async execute(args, exec) {
      const resolved = resolveWorkspacePublish(args);
      const root = await resolveWorkspaceRoot(workspaceRoot(exec));
      const absolutePath = await resolveExistingWorkspacePath(
        root,
        workspaceCandidate(root, resolved.path),
      );
      const info = statSync(absolutePath);
      if (!info.isFile()) throw new Error(`${resolved.path} is not a regular file`);
      return { path: resolved.path, bytes: info.size };
    },
    presentCall: (args) => {
      const published = describeWorkspacePublish(args);
      return {
        card: "generic",
        kind: "edit",
        title: `Publish ${published?.path ?? String(args.path ?? "").slice(0, 160)}`,
        ...(published === null ? {} : { locations: [{ path: published.path }] }),
      };
    },
  });
}

export function createFfmpegEncodeTool(encode = encodeWorkspaceVideo) {
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
          "Workspace-relative output (.mp4, .mkv, or .mov). Omit to use outputs/<name>.mp4.",
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
    timeoutMs: TIMEOUT_MS,
    async execute(args, exec) {
      const resolved = resolveFfmpegEncode(args);
      const root = workspaceRoot(exec);
      const absolutePath = await prepareTarget(root, resolved.destination, resolved.overwrite);
      let inputAbsolute = null;
      let subtitlesAbsolute = null;
      if (resolved.input) {
        const workspace = await resolveWorkspaceRoot(root);
        inputAbsolute = await resolveExistingWorkspacePath(
          workspace,
          workspaceCandidate(workspace, resolved.input),
        );
        if (resolved.subtitles) {
          subtitlesAbsolute = await resolveExistingWorkspacePath(
            workspace,
            workspaceCandidate(workspace, resolved.subtitles),
          );
        }
      }
      const result = await encode({
        ...resolved,
        absolutePath,
        inputAbsolute,
        subtitlesAbsolute,
      }, { signal: exec.signal });
      return {
        path: resolved.destination,
        bytes: result.bytes,
        encoder: result.encoder,
        speed: result.speed,
      };
    },
    presentCall: (args) => {
      const encoded = describeFfmpegEncode(args);
      return {
        card: "generic",
        kind: "edit",
        title: encoded?.pattern
          ? `Encode ${encoded.pattern} → ${encoded.destination}`
          : `Encode ${encoded?.destination ?? String(args.destination ?? "").slice(0, 160)}`,
        ...(encoded === null ? {} : { locations: [{ path: encoded.destination }] }),
      };
    },
  });
}

export function apply(ctx) {
  ctx.systemPrompt.section({ name: "tool:drive_fetch", order: 115, text: PROMPT });
  ctx.tools.register(createFetchTool());
  ctx.tools.register(createUrlFetchTool());
  ctx.tools.register(createWorkspacePublishTool());
  ctx.tools.register(createFfmpegEncodeTool());
}
