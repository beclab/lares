/**
 * The approval card dsh shows in the composer: localized reason as the
 * headline, and the correlated tool call's command underneath.
 */

function commandFromArgs(argsRaw) {
  try {
    const args = JSON.parse(argsRaw ?? "");
    return typeof args?.command === "string" ? args.command : "";
  } catch {
    return "";
  }
}

export function approvalCommand(items, callId) {
  if (!callId) return "";
  const rows = Array.isArray(items) ? items : [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.type === "tool" && row.callId === callId) return commandFromArgs(row.argsRaw);
  }
  return "";
}

function localizedReason(displayReason, locale) {
  if (typeof displayReason === "string") return displayReason;
  if (!displayReason || typeof displayReason !== "object") return "";
  const lang = String(locale ?? "en").toLowerCase().startsWith("zh") ? "zh" : "en";
  const text = displayReason[lang] ?? displayReason.en;
  return typeof text === "string" ? text : "";
}

export function presentApproval(approval, items = [], locale = "en") {
  if (!approval) return null;
  const localized = localizedReason(approval.displayReason, locale);
  const reason = localized || (typeof approval.reason === "string" ? approval.reason : "");
  return {
    toolName: typeof approval.toolName === "string" ? approval.toolName : "",
    callId: approval.callId,
    reason,
    command: approvalCommand(items, approval.callId),
  };
}
