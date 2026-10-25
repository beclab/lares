/**
 * What a device's Agent re-reads of its earlier turns. A weather lookup left ~9k tokens of search
 * results in the Session, and every later request carried them; on Qwen3.5-9B a request whose
 * cached prefix was evicted re-read all of it (2-6 s). Tool results from before the user's latest
 * message are replaced by a one-line note once they pass `limit` characters. The Agent's own
 * answers stay, so a follow-up still has the turn's conclusion.
 *
 * The rewrite is deterministic: a result is shortened the first time it falls behind a user
 * message and reads the same from then on, so the engine's prefix cache holds across later turns.
 */
export function compactEarlierToolResults(messages, { limit = 1500 } = {}) {
  if (!Array.isArray(messages)) return { messages, compacted: 0 };
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === "user") { lastUser = i; break; }
  let compacted = 0;
  const next = messages.map((message, index) => {
    if (index >= lastUser || message?.role !== "tool") return message;
    const text = typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "");
    if (text.length <= limit) return message;
    compacted++;
    return { ...message, content: `[Earlier tool result of ${text.length} characters omitted; the answer that followed it holds what mattered.]` };
  });
  return { messages: compacted ? next : messages, compacted };
}
