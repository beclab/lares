/**
 * Qwen3.5 sometimes writes a tool call into reasoning_content. The serving
 * parser can drop the opening and leave only the tail, so the agent loop sees
 * a finished answer and never runs the tool. Detect that and steer one retry.
 */

const LEAKED = /<\/(?:tool_call|function)>/;
const PARAM = /<parameter=([A-Za-z0-9_-]+)>\n?([\s\S]*?)<\/parameter>/g;
const FUNCTION_NAME = /<function=([A-Za-z0-9_-]+)>/;

export function assistantLeakedToolCall(message) {
  const content = message?.content;
  if (!Array.isArray(content)) return false;
  if (content.some((block) => block?.type === "tool-call")) return false;
  return LEAKED.test(reasoningText(content));
}

export function leakedToolCallInTurn(events, turn) {
  let message = null;
  for (const event of events ?? []) {
    if (event?.type === "assistant/message" && event?.data?.turn === turn) message = event.data.message;
  }
  return message !== null && assistantLeakedToolCall(message);
}

/**
 * Whatever of the dropped call is still readable: function name and complete
 * parameters. The command itself is often already gone.
 */
export function leakedToolCallHint(message) {
  const text = reasoningText(message?.content);
  const name = FUNCTION_NAME.exec(text)?.[1];
  const params = [];
  for (const match of text.matchAll(PARAM)) {
    const value = match[2].trim();
    if (value) params.push(`${match[1]}=${value}`);
  }
  const bits = [];
  if (name) bits.push(`函数 ${name}`);
  if (params.length) bits.push(params.join("；"));
  return bits.join("，");
}

export function leakedToolCallSteerText(hint) {
  const recovered = hint ? `还能看到的意图：${hint}。` : "";
  return `上一次工具调用没有执行：调用标记写进了思考，系统没有收到工具调用。${recovered}请立刻通过工具接口重新调用，不要把工具标记写进思考。`;
}

function reasoningText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "reasoning" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}
