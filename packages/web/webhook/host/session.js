import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { basename } from "node:path";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { HttpError } from "@olares/lares-core/tools/http";
import { workspaceRootFromEnv } from "@olares/lares-core/workspace/env";
import { sessionOutcome } from "./reply.js";

const MAX_JOBS = 32;

function sessionTitle(prompt) {
  const line = prompt.split("\n")[0]?.trim() ?? "";
  return line.slice(0, 80) || "Webhook";
}

export function createJobBook() {
  /** @type {Map<string, { id: string, agent: any, started: boolean, done: boolean, text: string }>} */
  const jobs = new Map();

  function finish(job) {
    if (job.done) return;
    try {
      const outcome = sessionOutcome(job.agent.session);
      job.text = outcome.text;
      job.error = outcome.error ?? "";
    } catch {
      job.text = "";
    }
    job.done = true;
  }

  return {
    track(agent) {
      const id = String(agent.session.id);
      const job = { id, agent, started: agent.status === "running", done: false, text: "", error: "" };
      const stop = agent.ctx.on("agent/status", (payload) => {
        if (payload?.status === "running") job.started = true;
        if (payload?.status === "idle" && job.started) {
          finish(job);
          stop();
        }
      });
      jobs.set(id, job);
      while (jobs.size > MAX_JOBS) {
        const oldest = jobs.keys().next().value;
        if (oldest === undefined) break;
        jobs.delete(oldest);
      }
      return job;
    },
    view(id) {
      const job = jobs.get(id);
      if (!job) return null;
      if (!job.done && job.agent.status === "running") job.started = true;
      if (!job.done && job.agent.status === "idle" && job.started) finish(job);
      if (!job.done) return { id: job.id, status: "running", text: "" };
      return {
        id: job.id,
        status: "idle",
        text: job.text,
        ...(job.error ? { error: job.error } : {}),
      };
    },
  };
}

/**
 * Open one root session and hand it the prompt. Returns the session id without
 * waiting for the agent to finish; `book.view` reads the reply once it is idle.
 * The preset lease stays held until the prompt is admitted.
 *
 * @param {import("@deepseek-ai/cordis").Context} ctx
 */
export async function submitPrompt(ctx, book, config, prompt) {
  const workspacePath = config.workspacePath || workspaceRootFromEnv();
  if (!workspacePath) throw new HttpError("workspace_unavailable", 409, "no workspace configured");
  mkdirSync(workspacePath, { recursive: true });

  const preset = await ctx.agentPresets.resolve();
  const scope = await ctx.agentPresets.acquireScope(preset.id);
  try {
    const workspace = await ctx.workspaceRegistry.create(workspacePath, basename(workspacePath) || "Webhook");
    const sessionId = SessionId(`webhook-${randomUUID()}`);
    const selection = ctx.agentDefaultModel.currentSelection();
    const handle = await ctx.agents.create({
      sessionId,
      meta: { cwd: workspace.path, agentPreset: preset.id },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: async (agentCtx) => {
        await ctx.agentPresets.mount(agentCtx, preset.id);
      },
    });
    await workspace.attachSession(sessionId);
    const permission = ctx.permissionPresets.defaultPreset;
    ctx.permissionPresets.resolve(permission);
    ctx.permissionPresets.set(handle.agent.session, permission);
    try {
      ctx.sessionTitle.rename(handle.agent.session, sessionTitle(prompt));
    } catch (err) {
      ctx.logger.warn(`webhook title skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
    const job = book.track(handle.agent);
    handle.agent.followup(createUserMessage({
      content: [{ type: "text", text: prompt }],
      source: { kind: "user" },
    }));
    if (handle.agent.status === "running") job.started = true;
    return { id: job.id };
  } finally {
    await scope[Symbol.asyncDispose]();
  }
}
