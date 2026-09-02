const SAFE_MODEL_ID = /^[^\u0000-\u001f\u007f]{1,512}$/;
/** pi-ai's thinking vocabulary; a Router level outside it has no wire spelling to declare. */
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/**
 * The capability flags one catalog row declares, named without Router's
 * `supports_` prefix. Router spells them differently per surface — the gateway
 * catalog lists bare tokens (`vision`), its admin API a `supports_*`-keyed
 * dict — and both spellings mean the same flag.
 */
function capabilities(item) {
  const declared = Array.isArray(item.supports)
    ? item.supports
    : item.supports && typeof item.supports === "object"
      ? Object.keys(item.supports).filter((key) => item.supports[key] === true)
      : [];
  const flags = new Set();
  for (const entry of declared) {
    const flag = String(entry ?? "").trim().toLowerCase().replace(/^supports_/, "");
    if (flag) flags.add(flag);
  }
  if (item.supports_vision === true) flags.add("vision");
  return flags;
}

/**
 * The effort levels Router advertises for one model, keyed by pi-ai level with
 * Router's own spelling as the wire value. A dict offering nothing beyond `off`
 * is no capability at all, and pi-ai rejects it.
 */
function reasoningEfforts(item, flags) {
  if (!flags.has("reasoning_effort")) return null;
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
    const flags = capabilities(item);
    rows.push({
      id,
      name: id,
      mode: String(item.mode ?? "").trim().toLowerCase() || null,
      supportsVision: flags.has("vision"),
      reasoningEfforts: reasoningEfforts(item, flags),
      contextWindow: tokenCount(item.context_size),
      maxTokens: tokenCount(item.max_output_tokens),
    });
  }
  return rows;
}
