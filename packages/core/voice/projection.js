/** Read-only records: native dsh events remain the authority for task execution. */
export function projectVoiceRecords(records, native = []) {
  const tasks = new Map();
  for (const row of records) {
    if (row.role !== "task" || !row.taskId) continue;
    try { const task = JSON.parse(row.text); if (Number.isInteger(task.turn)) tasks.set(row.taskId, task.turn); } catch { /* A delegation request is text, not a result. */ }
  }
  const request = (row) => row.requestId || row.data?.source?.rpcId;
  const turn = (row) => row.turn ?? row.location?.turn?.turn;
  const role = (row) => row.type || row.kind;
  const rows = [];
  for (const record of records) {
    if (!["user", "assistant"].includes(record.role) || !record.text) continue;
    const taskTurn = record.taskTurn ?? tasks.get(record.taskId);
    const match = record.taskId && native.find((row) => record.role === "user"
      ? role(row) === "user" && request(row) === record.taskId
      : ["assistant", "closing"].includes(role(row)) && taskTurn != null && turn(row) === taskTurn);
    if (match) {
      if (record.role === "assistant" && record.text !== (match.text || match.data?.text)) rows.push({ ...record, attachedTo: match.key || match.id, summary: true });
      continue;
    }
    rows.push({ ...record, type: record.role, pending: record.status === "streaming" });
  }
  return rows.sort((a, b) => a.anchorSeq - b.anchorSeq || a.sequence - b.sequence || a.id.localeCompare(b.id));
}

export function mergeVoiceTranscript(native, records) {
  const projected = projectVoiceRecords(records, native);
  const rows = [...native];
  for (const row of projected.filter((item) => !item.summary)) {
    const next = rows.findIndex((item) => !item.voiceId && (item.anchorSeq ?? item.seq ?? Infinity) > row.anchorSeq);
    rows.splice(next < 0 ? rows.length : next, 0, row);
  }
  for (const row of projected.filter((item) => item.summary)) {
    const index = rows.findIndex((item) => (item.key || item.id) === row.attachedTo);
    if (index >= 0) rows[index] = { ...rows[index], voiceSummary: row.text };
  }
  return rows;
}

/** Paginated long polling is independent of capture, panel mounts and playback. */
export function subscribeVoiceHistory({ request, sessionId, onRecords, onError = () => {} }) {
  const abort = new AbortController();
  let version = -1;
  const task = (async () => {
    while (!abort.signal.aborted) {
      try {
        let after = 0; let next; const rows = [];
        do {
          const response = await request("/api/lares/voice/history", { method: "POST", signal: abort.signal,
            body: { sessionId, after, limit: 200, version: after ? undefined : version, waitMs: after || version < 0 ? 0 : 20000 } });
          if (!response.ok) throw new Error(response.body?.error?.code || "voice_records_failed");
          rows.push(...response.body.records); next = response.body.next; after = next;
          if (!next) { version = response.body.version; if (!abort.signal.aborted) onRecords(rows); }
        } while (next && !abort.signal.aborted);
      } catch (error) {
        if (abort.signal.aborted) return;
        onError(error);
        await new Promise((resolve) => { const finish = () => { clearTimeout(timer); abort.signal.removeEventListener("abort", finish); resolve(); }; const timer = setTimeout(finish, 2000); abort.signal.addEventListener("abort", finish, { once: true }); });
      }
    }
  })();
  return Object.assign(() => abort.abort(), { done: task });
}
