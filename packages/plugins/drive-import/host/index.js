/**
 * Lares drive-import Host: the `drive_fetch` tool.
 *
 * A file in the user's Olares files backend cannot be opened from the chat —
 * the preview only serves the session workspace. The copy is a tool call rather
 * than a shell command because that is what puts the result in dsh's produced-file
 * vocabulary: a call view declaring `kind: 'edit'` with `locations` is what makes
 * the chip and the inline-code mention clickable.
 */
import { existsSync, statSync } from "node:fs";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { workspaceRootFromEnv } from "../../bundle-web/host/default-workspace.js";
import { ensureWorkspaceDirectory, workspaceCandidate } from "../../shared/host/workspace-path.js";
import { runOlaresDownload } from "./download.js";
import { describeFetch, resolveFetch } from "./paths.js";

export const name = "lares-drive-import";
export const inject = ["tools", "systemPrompt"];

/** Media-sized transfers over the user's own link; well past the default budget. */
const TIMEOUT_MS = 30 * 60 * 1000;

const PROMPT = [
  "Olares files paths (drive/…, sync/…, external/…, and the cloud-account namespaces) live in the",
  "user's files backend, not in this workspace: they cannot be read, edited, or previewed in place,",
  "and a download task started through olares-cli knowledge lands there too.",
  "Use drive_fetch to copy one such file into the workspace whenever the user wants to open, preview,",
  "or work on it, and name the returned workspace path in markdown inline code so it stays clickable.",
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

export function apply(ctx) {
  ctx.systemPrompt.section({ name: "tool:drive_fetch", order: 115, text: PROMPT });
  ctx.tools.register(createFetchTool());
}
