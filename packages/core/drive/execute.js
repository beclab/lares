import { statSync } from "node:fs";
import { encodeWorkspaceVideo } from "../media/ffmpeg-run.js";
import { workspaceRootFromSession } from "../workspace/env.js";
import {
  prepareWorkspaceTarget,
  resolveExistingWorkspacePath,
  resolveWorkspaceRoot,
  workspaceCandidate,
} from "../workspace/path.js";
import { runOlaresDownload } from "./download.js";
import { statFilesFile } from "./ls.js";
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
import { downloadUrl, saveDataUrl } from "./url-download.js";

export async function executeDriveFetch(args, exec, download) {
  const run = download ?? runOlaresDownload;
  const { source, destination } = resolveFetch(args);
  const root = workspaceRootFromSession(exec);
  const absolutePath = await prepareWorkspaceTarget(root, destination, args.overwrite === true);
  await run(source, absolutePath, {
    signal: exec.signal,
    overwrite: args.overwrite === true,
  });
  return { path: destination, bytes: statSync(absolutePath).size };
}

export async function executeUrlFetch(args, exec, download) {
  const run = download ?? downloadUrl;
  const resolved = resolveUrlFetch(args);
  const root = workspaceRootFromSession(exec);
  const absolutePath = await prepareWorkspaceTarget(root, resolved.destination, args.overwrite === true);
  const result = resolved.kind === "data"
    ? await saveDataUrl(String(args.url), absolutePath, { overwrite: args.overwrite === true })
    : await run(resolved.source, absolutePath, {
      signal: exec.signal,
      overwrite: args.overwrite === true,
    });
  return { path: resolved.destination, bytes: result.bytes, mediaType: result.mediaType };
}

export async function executeWorkspacePublish(args, exec, statFile) {
  const resolved = resolveWorkspacePublish(args);
  if (resolved.origin === "files") {
    const info = await (statFile ?? statFilesFile)(resolved.path, { signal: exec.signal });
    return { path: resolved.path, bytes: info.size };
  }
  const root = await resolveWorkspaceRoot(workspaceRootFromSession(exec));
  const absolutePath = await resolveExistingWorkspacePath(
    root,
    workspaceCandidate(root, resolved.path),
  );
  const info = statSync(absolutePath);
  if (!info.isFile()) throw new Error(`${resolved.path} is not a regular file`);
  return { path: resolved.path, bytes: info.size };
}

export async function executeFfmpegEncode(args, exec, encode) {
  const run = encode ?? encodeWorkspaceVideo;
  const resolved = resolveFfmpegEncode(args);
  const root = workspaceRootFromSession(exec);
  const absolutePath = await prepareWorkspaceTarget(root, resolved.destination, resolved.overwrite);
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
  const result = await run({
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
}

export function producedEditCard(title, path) {
  return {
    card: "generic",
    kind: "edit",
    title,
    ...(path ? { locations: [{ path }] } : {}),
  };
}

export function presentDriveFetch(args) {
  const fetched = describeFetch(args);
  return producedEditCard(
    `Fetch ${fetched?.source ?? String(args.path ?? "")}`,
    fetched?.destination,
  );
}

export function presentUrlFetch(args) {
  const fetched = describeUrlFetch(args);
  return producedEditCard(
    fetched?.kind === "data"
      ? `Save ${fetched.destination}`
      : `Download ${fetched?.source ?? String(args.url ?? "").slice(0, 160)}`,
    fetched?.destination,
  );
}

export function presentWorkspacePublish(args) {
  const published = describeWorkspacePublish(args);
  return producedEditCard(
    `Publish ${published?.path ?? String(args.path ?? "").slice(0, 160)}`,
    published?.path,
  );
}

export function presentFfmpegEncode(args) {
  const encoded = describeFfmpegEncode(args);
  return producedEditCard(
    encoded?.pattern
      ? `Encode ${encoded.pattern} → ${encoded.destination}`
      : `Encode ${encoded?.destination ?? String(args.destination ?? "").slice(0, 160)}`,
    encoded?.destination,
  );
}
