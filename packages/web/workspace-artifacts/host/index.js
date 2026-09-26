import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import {
  driveFetchDefinition,
  ffmpegEncodeDefinition,
  urlFetchDefinition,
  workspacePublishDefinition,
} from "@olares/lares-core/drive/tools";
import { DRIVE_IMPORT_PROMPT } from "@olares/lares-core/drive/paths";
import {
  recoverMediaGenerations,
  recoveredGenerationsNote,
} from "@olares/lares-core/media/generation";
import { MEDIA_GENERATE_PROMPT, mediaGenerateDefinition } from "@olares/lares-core/media/tool";
import {
  PRODUCED_GATE_PLUGIN,
  createProducedGateBudget,
  durableProducedPathsFromEvents,
  findUnopenableProducedPaths,
  producedGateSteerText,
  unpublishedMediaPathsFromEvents,
  unpublishedMediaSteerText,
} from "@olares/lares-core/files/produced-gate";
import {
  publishedPathsFromToolCall,
} from "@olares/lares-core/files/published-tools";

export const name = "lares-workspace-artifacts";
export const inject = ["tools", "systemPrompt", "sessionProjections"];

function withPublishedCapture(definition, capture) {
  if (!capture) return definition;
  const execute = definition.execute;
  return {
    ...definition,
    async execute(args, exec) {
      const value = await execute(args, exec);
      capture(definition.name, args, exec, value);
      return value;
    },
  };
}

/** @param download - seam for tests; the real olares-cli download otherwise. */
export function createFetchTool(download, capture) {
  return defineTool(withPublishedCapture(driveFetchDefinition(download), capture));
}

export function createUrlFetchTool(download, capture) {
  return defineTool(withPublishedCapture(urlFetchDefinition(download), capture));
}

export function createWorkspacePublishTool(statFile, capture) {
  return defineTool(withPublishedCapture(workspacePublishDefinition(statFile), capture));
}

export function createFfmpegEncodeTool(encode, capture) {
  return defineTool(withPublishedCapture(ffmpegEncodeDefinition(encode), capture));
}

export function createMediaGenerateTool(deps, capture) {
  return defineTool(withPublishedCapture(mediaGenerateDefinition(deps), capture));
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
  const deps = options.deps ?? {};
  return ctx.on("agent/turn-stopping", async ({ agent, turn, signal }) => {
    if (signal?.aborted) return;
    const cwd = sessionCwd(agent);
    if (cwd === null) return;
    const events = agent.session?.events;
    if (!events) return;
    const unpublished = unpublishedMediaPathsFromEvents(events, turn);
    if (unpublished.length > 0) {
      if (!budget.consume(String(agent.id ?? agent.sessionId ?? ""), turn)) return;
      agent.steer(createUserMessage({
        content: [{ type: "text", text: unpublishedMediaSteerText(unpublished) }],
        source: { kind: "plugin", plugin: PRODUCED_GATE_PLUGIN },
      }));
      return;
    }
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

/**
 * Future sessions also publish dsh-native presentation events. Historical
 * sessions are recovered independently by the client replay projection.
 */
export function installArtifactPresentations(ctx) {
  const pending = new WeakMap();
  const capture = (name, args, exec, value) => {
    const paths = publishedPathsFromToolCall(name, args, value);
    if (paths.length === 0 || !exec?.agent?.session) return;
    const boundary = ctx.sessionProjections.stateOf(exec.agent.session, "turnBoundary");
    if (boundary === undefined || boundary.openTurnStartSeq === null) return;
    pending.set(exec, {
      session: exec.agent.session,
      turn: boundary.lastTurn,
      paths,
    });
  };
  ctx.on("tools/result", (exec, result) => {
    const delivery = pending.get(exec);
    pending.delete(exec);
    if (delivery === undefined || result.isError) return;
    delivery.session.append("deliverables/presented", {
      turn: delivery.turn,
      callId: exec.callId,
      files: delivery.paths.map((path) => ({ path })),
    });
  });
  return capture;
}

/**
 * At the first step of each turn, settle generations an earlier turn started
 * but never saw finish, and tell the model what happened to them.
 */
export function installMediaRecovery(ctx, deps = {}) {
  const lastTurn = new WeakMap();
  return ctx.on("agent/pre-step", async ({ agent, turn, signal }, next) => {
    const decision = await next();
    if (decision.kind !== "enter" || lastTurn.get(agent) === turn) return decision;
    lastTurn.set(agent, turn);
    const cwd = sessionCwd(agent);
    if (cwd === null || !agent.session) return decision;
    let recovered;
    try {
      recovered = await recoverMediaGenerations(agent.session, { turn, workspaceRoot: cwd }, { ...deps, signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn(`[lares] media recovery skipped: ${error instanceof Error ? error.message : String(error)}`);
      return decision;
    }
    const note = recoveredGenerationsNote(recovered);
    if (!note) return decision;
    return {
      kind: "enter",
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: "text", text: note }],
          source: { kind: "plugin", plugin: "lares-media-recovery" },
        }),
      ],
    };
  });
}

export function apply(ctx) {
  ctx.systemPrompt.section({ name: "tool:drive_fetch", order: 115, text: DRIVE_IMPORT_PROMPT });
  const capture = installArtifactPresentations(ctx);
  ctx.tools.register(createFetchTool(undefined, capture));
  ctx.tools.register(createUrlFetchTool(undefined, capture));
  ctx.tools.register(createWorkspacePublishTool(undefined, capture));
  ctx.tools.register(createFfmpegEncodeTool(undefined, capture));
  ctx.systemPrompt.section({ name: "tool:media_generate", order: 116, text: MEDIA_GENERATE_PROMPT });
  ctx.tools.register(createMediaGenerateTool(undefined, capture));
  installProducedOpenabilityGate(ctx);
  installMediaRecovery(ctx);
}
