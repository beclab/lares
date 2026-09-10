import { interpolate } from "@olares/lares-core/i18n/t";
import { STAGE_COPY } from "@olares/lares-core/larepass/stage-copy";
import {
  clockParts,
  durationParts,
  latencySeconds,
  throughputTokens,
} from "@olares/lares-core/larepass/turn-metrics";

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

export function firstLine(text) {
  const value = String(text ?? "");
  const newline = value.indexOf("\n");
  return newline === -1 ? value : value.slice(0, newline);
}

export function latestLine(text) {
  const visible = String(text ?? "").trimEnd();
  const newline = visible.lastIndexOf("\n");
  return newline === -1 ? visible : visible.slice(newline + 1);
}

export function thinkSummary(row) {
  return row?.running ? latestLine(row.text) : firstLine(row.text);
}

export function failText(t, failed, error) {
  if (failed === "unauthorized") return t("chat.unauthorized");
  if (failed === "missing" || failed === "unreachable" || failed === "error") {
    return t(`probe.${failed}`, { http: "", error: "" });
  }
  return t("chat.failed", { error: failed || error });
}

function clockText(time, t, now) {
  const { clock, scope, y, m, d } = clockParts(time, now);
  if (scope === "day") return clock;
  return `${t(scope === "md" ? "clock.md" : "clock.ymd", { y, m, d })} ${clock}`;
}

/**
 * The reply's own footer: when it landed, and whatever the log recorded about
 * how it got there. Each reading is dropped rather than faked when the events
 * never carried it.
 */
export function metricsLine(metrics, t, now = Date.now()) {
  if (!metrics?.time) return "";
  const parts = [clockText(metrics.time, t, now)];
  if (metrics.runMs !== undefined) {
    const { minutes, seconds } = durationParts(metrics.runMs);
    parts.push(t("message.ranFor", {
      duration: minutes > 0
        ? t("duration.minutes", { minutes, seconds })
        : t("duration.seconds", { seconds }),
    }));
  }
  if (metrics.ttftMs !== undefined) {
    parts.push(t("message.ttft", { seconds: latencySeconds(metrics.ttftMs) }));
  }
  if (metrics.tokensPerSecond !== undefined) {
    parts.push(t("message.tokensPerSecond", { tps: throughputTokens(metrics.tokensPerSecond) }));
  }
  return parts.join(" · ");
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
