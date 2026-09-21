import {
  LARES_PUBLISH_TOOLS,
  durablePathFromToolCall,
  parseToolArguments,
  toolResultIsError,
} from "./published-tools.js";

export const LARES_PUBLISHED_KEY = "lares-published";

function appendSurfaceResult(event) {
  return event?.type === "tool/result" && event.surfaceOp === "append";
}

/**
 * Replayable projection for artifacts declared by Lares-specific tools.
 *
 * Unlike dsh's first-party deliverables projection, this definition recognizes
 * workspace_publish and the Lares fetch/encode tools. It derives only from
 * persisted events, so sessions created before the dsh 0.1.5 migration regain
 * the same turn-tail previews when history is reopened.
 */
export const laresPublishedDefinition = {
  kind: LARES_PUBLISHED_KEY,
  match(event) {
    if (event?.type === "turn/start") {
      return { id: String(event.data.turn), role: "start" };
    }
    if (event?.type === "tool/call" && LARES_PUBLISH_TOOLS.has(event.data.name)) {
      return { id: String(event.data.turn), role: "update" };
    }
    if (appendSurfaceResult(event)) {
      return { id: String(event.data.turn), role: "update" };
    }
    return null;
  },
  start(_context, match) {
    if (match.event.type !== "turn/start") {
      throw new Error("lares-published start requires turn/start");
    }
    return {
      turn: match.event.data.turn,
      calls: new Map(),
      published: [],
    };
  },
  update(context, match) {
    const event = match.event;
    if (event.type === "tool/call") {
      const calls = new Map(context.state.calls);
      calls.set(
        String(event.data.callId),
        durablePathFromToolCall(event.data.name, parseToolArguments(event.data.arguments)),
      );
      return { ...context.state, calls };
    }
    if (event.type !== "tool/result" || toolResultIsError(event)) return context.state;
    const callId = String(event.data?.message?.source?.callId ?? "");
    const path = context.state.calls.get(callId);
    if (!path || context.state.published.some((item) => item.path === path)) {
      return context.state;
    }
    return {
      ...context.state,
      published: [...context.state.published, { seq: event.seq, path, callId }],
    };
  },
  buildLocationData(context, scope, previous) {
    if (scope !== "turn" || context.state === undefined) return null;
    if (
      previous?.kind === "turn"
      && previous.turn === context.state.turn
      && previous.key === LARES_PUBLISHED_KEY
      && previous.value.published === context.state.published
    ) {
      return previous;
    }
    return {
      kind: "turn",
      turn: context.state.turn,
      key: LARES_PUBLISHED_KEY,
      value: { published: context.state.published },
    };
  },
};
