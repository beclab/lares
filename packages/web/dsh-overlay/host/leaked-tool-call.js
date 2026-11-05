/**
 * A turn that only leaked a tool call into reasoning is not an answer.
 * Steer the same turn so the model calls the tool for real. Two tries, then stop.
 */
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import {
  leakedToolCallHint,
  leakedToolCallInTurn,
  leakedToolCallSteerText,
} from "@olares/lares-core/agent/leaked-tool-call";

const LIMIT = 2;
const used = new Map();

export const name = "lares-leaked-tool-call";
export const inject = [];

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.on("agent/turn-stopping", ({ agent, turn, signal }) => {
    if (signal?.aborted) return;
    const events = agent?.session?.events;
    if (!events || !leakedToolCallInTurn(events, turn)) return;
    const key = `${agent?.id ?? ""}:${turn}`;
    const count = used.get(key) ?? 0;
    if (count >= LIMIT) return;
    used.set(key, count + 1);
    let hint = "";
    for (const event of events) {
      if (event?.type === "assistant/message" && event?.data?.turn === turn) {
        hint = leakedToolCallHint(event.data.message);
      }
    }
    agent.steer(createUserMessage({
      content: [{ type: "text", text: leakedToolCallSteerText(hint) }],
      source: { kind: "plugin", plugin: name },
    }));
  });
}
