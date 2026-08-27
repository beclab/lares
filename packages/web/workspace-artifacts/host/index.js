import { defineTool } from "@deepseek-ai/dsh-tools";
import {
  driveFetchDefinition,
  ffmpegEncodeDefinition,
  urlFetchDefinition,
  workspacePublishDefinition,
} from "@olares/lares-core/drive/tools";
import { DRIVE_IMPORT_PROMPT } from "@olares/lares-core/drive/paths";

export const name = "lares-workspace-artifacts";
export const inject = ["tools", "systemPrompt"];

/** @param download - seam for tests; the real olares-cli download otherwise. */
export function createFetchTool(download) {
  return defineTool(driveFetchDefinition(download));
}

export function createUrlFetchTool(download) {
  return defineTool(urlFetchDefinition(download));
}

export function createWorkspacePublishTool(statFile) {
  return defineTool(workspacePublishDefinition(statFile));
}

export function createFfmpegEncodeTool(encode) {
  return defineTool(ffmpegEncodeDefinition(encode));
}

export function apply(ctx) {
  ctx.systemPrompt.section({ name: "tool:drive_fetch", order: 115, text: DRIVE_IMPORT_PROMPT });
  ctx.tools.register(createFetchTool());
  ctx.tools.register(createUrlFetchTool());
  ctx.tools.register(createWorkspacePublishTool());
  ctx.tools.register(createFfmpegEncodeTool());
}
