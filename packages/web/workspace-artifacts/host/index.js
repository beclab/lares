import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import {
  driveFetchDefinition,
  ffmpegEncodeDefinition,
  urlFetchDefinition,
  workspacePublishDefinition,
} from "@olares/lares-core/drive/tools";
import { DRIVE_IMPORT_PROMPT } from "@olares/lares-core/drive/paths";
import { statFilesFile } from "@olares/lares-core/drive/ls";
import {
  PRODUCED_GATE_PLUGIN,
  createProducedGateBudget,
  durableProducedPathsFromEvents,
  findUnopenableProducedPaths,
  producedGateSteerText,
} from "@olares/lares-core/files/produced-gate";

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

function sessionCwd(agent) {
  const cwd = agent?.session?.header?.cwd ?? agent?.header?.cwd;
  return typeof cwd === "string" && cwd.trim() !== "" ? cwd : null;
}

/**
 * Before a turn closes, durable Produced paths must still open. Missing media /
 * write outputs steer the agent to restore them; research scratch is not gated.
 */
export function installProducedOpenabilityGate(ctx, options = {}) {
  const budget = options.budget ?? createProducedGateBudget();
  const deps = {
    statFilesFile: options.statFilesFile ?? statFilesFile,
    ...(options.deps ?? {}),
  };
  return ctx.on("agent/turn-stopping", async ({ agent, turn, signal }) => {
    if (signal?.aborted) return;
    const cwd = sessionCwd(agent);
    if (cwd === null) return;
    const events = agent.session?.events;
    if (!events) return;
    const paths = durableProducedPathsFromEvents(events, turn);
    if (paths.length === 0) return;
    const missing = await findUnopenableProducedPaths(cwd, paths, deps);
    if (missing.length === 0) return;
    if (!budget.consume(String(agent.id ?? agent.sessionId ?? ""), turn)) return;
    agent.steer(createUserMessage({
      content: [{ type: "text", text: producedGateSteerText(missing) }],
      source: { kind: "plugin", plugin: PRODUCED_GATE_PLUGIN },
    }));
  });
}

export function apply(ctx) {
  ctx.systemPrompt.section({ name: "tool:drive_fetch", order: 115, text: DRIVE_IMPORT_PROMPT });
  ctx.tools.register(createFetchTool());
  ctx.tools.register(createUrlFetchTool());
  ctx.tools.register(createWorkspacePublishTool());
  ctx.tools.register(createFfmpegEncodeTool());
  installProducedOpenabilityGate(ctx);
}
