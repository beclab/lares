import { deriveEventMessage, foldSurface } from "@deepseek-ai/dsh-session";
import { lastAssistantText } from "@olares/lares-core/webhook/reply";

function messagesOf(session) {
  const events = session.snapshotEvents();
  const folded = foldSurface(events);
  const messages = [];
  for (const seq of folded.nodes) {
    const projected = folded.projectedMessages.get(seq);
    const event = projected ? null : session.eventAt(seq);
    const message = projected ?? (event ? deriveEventMessage(event, folded.projectedMessages) : null);
    if (message) messages.push(message);
  }
  return { events, messages };
}

/** Latest assistant text, plus the last turn error when the turn did not succeed. */
export function sessionOutcome(session) {
  const { events, messages } = messagesOf(session);
  let error = "";
  for (const event of events) {
    if (event?.type !== "turn/end") continue;
    const reason = event.data?.reason;
    error = reason?.kind === "error" ? (reason.error?.message || "turn failed") : "";
  }
  return { text: lastAssistantText(messages), ...(error ? { error } : {}) };
}
