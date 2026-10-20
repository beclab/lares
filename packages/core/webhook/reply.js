import { textFromBlocks } from "../larepass/transcript.js";

/** Latest non-empty assistant text. An empty trailing message does not erase the previous reply. */
export function lastAssistantText(messages) {
  let text = "";
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.role !== "assistant") continue;
    const next = textFromBlocks(message.content);
    if (next) text = next;
  }
  return text;
}
