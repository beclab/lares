/**
 * What a device's Agent re-reads of its earlier turns. A weather lookup left ~9k tokens of search
 * results in the Session, and every later request carried them; on Qwen3.5-9B a request whose
 * cached prefix was evicted re-read all of it (2-6 s). Tool results from before the user's latest
 * message are replaced by a one-line note once they pass `limit` characters. The Agent's own
 * answers stay, so a follow-up still has the turn's conclusion.
 *
 * Results of the tools in `keep` stay whole: a skill's instructions are what later turns act on.
 * With ha-lighting compacted away after the first light turn, "把灯变成黄色" took 10 wrong hass-cli
 * commands and 12 s; with it kept, the first command was the skill's own `color_name` example.
 * A Session loads each skill once, so this does not grow with the conversation.
 *
 * The rewrite is deterministic: a result is shortened the first time it falls behind a user
 * message and reads the same from then on, so the engine's prefix cache holds across later turns.
 */
export function compactEarlierToolResults(messages, { limit = 1500, keep = ["skill"] } = {}) {
  if (!Array.isArray(messages)) return { messages, compacted: 0 };
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === "user") { lastUser = i; break; }
  const kept = new Set();
  for (const message of messages) for (const call of message?.tool_calls || []) if (keep.includes(call?.function?.name)) kept.add(call.id);
  let compacted = 0;
  const next = messages.map((message, index) => {
    if (index >= lastUser || message?.role !== "tool" || kept.has(message.tool_call_id)) return message;
    const text = typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "");
    if (text.length <= limit) return message;
    compacted++;
    return { ...message, content: `[Earlier tool result of ${text.length} characters omitted; the answer that followed it holds what mattered.]` };
  });
  return { messages: compacted ? next : messages, compacted };
}

/**
 * The Agent tools a device's Session keeps. Its 35 tools were 31k characters (~9k tokens) of every
 * request, re-read whenever the engine's cache had dropped the prefix; a voice device needs home
 * control (skills run hass-cli through bash), lookups and reminders. Only Sessions a device drives
 * are filtered: Lares's own clients, voice on the phone included, keep every tool.
 */
export const DEVICE_AGENT_TOOLS = Object.freeze(["bash", "skill", "read", "web_search", "web_fetch", "schedule_create", "schedule_list", "schedule_update", "schedule_delete"]);

export function keepDeviceTools(tools, allowed = DEVICE_AGENT_TOOLS) {
  if (!Array.isArray(tools)) return tools;
  return tools.filter((tool) => allowed.includes(tool?.name ?? tool?.function?.name));
}

/**
 * Sampling for a device's Agent. Asked to turn a light on or off, Qwen3.5-9B first says "好的，我帮您关灯。"
 * and then either calls the ha-lighting skill or ends there; the engine sampled that choice at the
 * model's default temperature of 1.0, so a light changed in about half of fresh Sessions. Replayed
 * on pptest03 (2026-10-27), 0.2 ran skill, lookup and the service call 10/10 for on and for off;
 * 0 was as reliable but repeats itself more readily on long tasks.
 */
export const DEVICE_AGENT_TEMPERATURE = 0.2;

/**
 * A device's web_search results, cut to the first `sources` sources of `chars` characters each. One
 * search for 北京天气 returned 8 sources of 1.3-2.4k characters (15k in all, page menus included), and
 * the Agent's answer re-read them: 6 s on pptest03. Replayed with 5 x 600 the weather answer kept its
 * temperatures 10/10 and the Agent took 1.3 s instead of 2.3 s. The cut is deterministic, so a cached
 * prefix stays valid. A result without a source list is left alone.
 */
export function capSearchResults(messages, { sources = 5, chars = 600 } = {}) {
  if (!Array.isArray(messages)) return messages;
  const searches = new Set();
  for (const message of messages) for (const call of message?.tool_calls || []) if (call?.function?.name === "web_search") searches.add(call.id);
  if (!searches.size) return messages;
  let changed = false;
  const next = messages.map((message) => {
    if (message?.role !== "tool" || !searches.has(message.tool_call_id) || typeof message.content !== "string") return message;
    const at = message.content.indexOf("\nSources:\n");
    if (at < 0) return message;
    const head = message.content.slice(0, at + "\nSources:\n".length);
    const items = message.content.slice(head.length).split(/\n(?=- \[)/);
    const kept = items.slice(0, sources).map((item) => (item.length > chars ? `${item.slice(0, chars)} …` : item));
    const content = head + kept.join("\n");
    if (content === message.content) return message;
    changed = true;
    return { ...message, content };
  });
  return changed ? next : messages;
}

/** The request a device's Agent sends: earlier tool results compacted, searches capped, and its own temperature. */
export function deviceAgentRequest(request) {
  if (!request || typeof request !== "object") return request;
  const { messages } = compactEarlierToolResults(request.messages);
  return { ...request, messages: capSearchResults(messages), temperature: DEVICE_AGENT_TEMPERATURE };
}
