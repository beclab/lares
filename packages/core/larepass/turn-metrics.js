/**
 * Turn timings read off the session log the way the harness client reads them:
 * the turn's own wall time, its first step's time to first token, and decode
 * throughput over the steps that report both a first token and provider usage.
 * Every event carries `time` (epoch ms), so nothing here needs a clock.
 */

function isTokenDelta(chunk) {
  return chunk?.type === "text-delta" || chunk?.type === "reasoning-delta";
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function createTurnMetrics() {
  const turns = new Map();

  const turnRow = (turn) => {
    const key = Number(turn) || 0;
    let row = turns.get(key);
    if (!row) {
      row = {
        startTime: 0,
        endTime: 0,
        messageTime: 0,
        ttftMs: null,
        ttftStep: Infinity,
        decodeMs: 0,
        decodeTokens: 0,
        steps: new Map(),
      };
      turns.set(key, row);
    }
    return row;
  };

  const stepRow = (row, step) => {
    const key = Number(step) || 0;
    let cell = row.steps.get(key);
    if (!cell) {
      cell = { startTime: 0, firstTokenTime: 0 };
      row.steps.set(key, cell);
    }
    return cell;
  };

  return {
    observe(event) {
      const time = Number(event?.time) || 0;
      if (!time) return;
      const data = event.data ?? {};
      const turn = data.turn ?? data.message?.turn;
      const step = data.step ?? data.message?.step;
      if (event.type === "turn/start") {
        turnRow(turn).startTime = time;
        return;
      }
      if (event.type === "turn/end") {
        turnRow(turn).endTime = time;
        return;
      }
      if (event.type === "step/start") {
        stepRow(turnRow(turn), step).startTime = time;
        return;
      }
      if (event.type === "assistant/chunk") {
        if (!isTokenDelta(data.chunk)) return;
        const cell = stepRow(turnRow(turn), step);
        if (!cell.firstTokenTime) cell.firstTokenTime = time;
        return;
      }
      if (event.type !== "assistant/message") return;
      const row = turnRow(turn);
      const index = Number(step) || 0;
      const cell = stepRow(row, index);
      row.messageTime = time;
      // The turn shows its earliest step's latency; later steps answer a tool
      // result rather than the person, so their wait is a different question.
      if (cell.startTime && cell.firstTokenTime && index < row.ttftStep) {
        row.ttftStep = index;
        row.ttftMs = Math.max(0, cell.firstTokenTime - cell.startTime);
      }
      const outputTokens = Number(data.usage?.outputTokens);
      if (cell.firstTokenTime && Number.isFinite(outputTokens) && outputTokens > 0) {
        row.decodeMs += Math.max(0, time - cell.firstTokenTime);
        row.decodeTokens += outputTokens;
      }
    },
    /** Readings for a turn the log has closed; null while it is still open. */
    value(turn) {
      const row = turns.get(Number(turn) || 0);
      if (!row?.startTime || !row.endTime) return null;
      const metrics = {
        time: row.messageTime || row.endTime,
        runMs: Math.max(0, row.endTime - row.startTime),
      };
      if (row.ttftMs !== null) metrics.ttftMs = row.ttftMs;
      if (row.decodeMs > 0 && row.decodeTokens > 0) {
        metrics.tokensPerSecond = row.decodeTokens / (row.decodeMs / 1000);
      }
      return metrics;
    },
  };
}

/** Wall clock of the reply, plus the calendar scope a reader needs to place it. */
export function clockParts(time, now = Date.now()) {
  const at = new Date(Number(time) || 0);
  const today = new Date(Number(now) || 0);
  const sameYear = at.getFullYear() === today.getFullYear();
  const sameDay = sameYear
    && at.getMonth() === today.getMonth()
    && at.getDate() === today.getDate();
  return {
    clock: `${pad2(at.getHours())}:${pad2(at.getMinutes())}`,
    scope: sameDay ? "day" : sameYear ? "md" : "ymd",
    y: at.getFullYear(),
    m: at.getMonth() + 1,
    d: at.getDate(),
  };
}

/** Run time as whole seconds, carrying into minutes with padded seconds. */
export function durationParts(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return { minutes, seconds: minutes > 0 ? pad2(seconds) : String(seconds) };
}

/** Sub-turn latency: one decimal under ten seconds, whole seconds beyond. */
export function latencySeconds(ms) {
  const seconds = Math.max(0, Number(ms) || 0) / 1000;
  return seconds < 10 ? String(Math.round(seconds * 10) / 10) : String(Math.round(seconds));
}

/** Decode throughput: whole tokens from ten up, one decimal below. */
export function throughputTokens(tokensPerSecond) {
  const value = Math.max(0, Number(tokensPerSecond) || 0);
  return value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
}
