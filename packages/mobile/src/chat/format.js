import { interpolate } from "@lares/core/i18n/t";
import { STAGE_COPY } from "@lares/core/larepass/stage-copy";

export function withPendingUser(items, pendingUser) {
  if (!pendingUser) return items;
  const last = [...items].reverse().find((row) => row.type === "user");
  if (last?.text === pendingUser) return items;
  return [...items, { type: "user", text: pendingUser, pending: true }];
}

export function lastIndexOfType(items, type) {
  for (let i = (items?.length ?? 0) - 1; i >= 0; i--) {
    if (items[i]?.type === type) return i;
  }
  return -1;
}

export function lastUserText(items) {
  for (let i = (items?.length ?? 0) - 1; i >= 0; i--) {
    const row = items[i];
    if (row?.type === "user" && !row.pending) {
      const text = String(row.text ?? "").trim();
      if (text) return text;
    }
  }
  return "";
}

export function thinkTitle(running, ms, t) {
  if (running) return t("think.running");
  const elapsed = Number(ms) || 0;
  if (elapsed <= 0) return t("think.doneUnknown");
  return t("think.done", { seconds: Math.max(1, Math.round(elapsed / 1000)) });
}

export function failText(t, failed, error) {
  if (failed === "unauthorized") return t("chat.unauthorized");
  if (failed === "missing" || failed === "unreachable" || failed === "error") {
    return t(`probe.${failed}`, { http: "", error: "" });
  }
  return t("chat.failed", { error: failed || error });
}

export function retryStatus(row) {
  const copy = STAGE_COPY.retry;
  const label = row.retryState === "started"
    ? copy.started
    : row.retryState === "cancelled"
      ? copy.cancelled
      : row.retryState === "active"
        ? copy.active
        : copy.scheduled;
  const maximum = row.mode === "normal" ? row.maxRetries : (row.maxRetries ?? "∞");
  return interpolate(copy.status, {
    label,
    retry: row.retry,
    maximum,
    seconds: row.seconds,
  });
}
