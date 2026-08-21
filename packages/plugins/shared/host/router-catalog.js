const SAFE_MODEL_ID = /^[^\u0000-\u001f\u007f]{1,512}$/;
/** pi-ai's thinking vocabulary; a Router level outside it has no wire spelling to declare. */
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/**
 * The effort levels Router advertises for one model, keyed by pi-ai level with
 * Router's own spelling as the wire value. A dict offering nothing beyond `off`
 * is no capability at all, and pi-ai rejects it.
 */
function reasoningEfforts(item) {
  const supports = Array.isArray(item.supports) ? item.supports : [];
  if (!supports.includes("reasoning_effort")) return null;
  const options = Array.isArray(item.reasoning_effort?.options) ? item.reasoning_effort.options : [];
  const efforts = {};
  for (const option of options) {
    const level = String(option ?? "").trim().toLowerCase();
    if (THINKING_LEVELS.has(level)) efforts[level] = level;
  }
  return Object.keys(efforts).some((level) => level !== "off") ? efforts : null;
}

/**
 * A token count Router states, or null when it states none. Router omits the
 * key rather than sending a zero, so anything non-positive here is a payload
 * that disagrees with its own contract and is treated as silence — a window of
 * zero would fail pi-ai's own validation on the way in.
 */
function tokenCount(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function routerCatalogRows(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.data)) return [];
  const rows = [];
  const seen = new Set();
  for (const item of payload.data) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id ?? "").trim();
    if (!SAFE_MODEL_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      name: id,
      mode: String(item.mode ?? "").trim().toLowerCase() || null,
      reasoningEfforts: reasoningEfforts(item),
      contextWindow: tokenCount(item.context_size),
      maxTokens: tokenCount(item.max_output_tokens),
    });
  }
  return rows;
}
