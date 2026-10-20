import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeJsonFile } from "../tools/json-file.js";
import { dshHome } from "../workspace/home.js";

const failure = (code, status = 400) => Object.assign(new Error(code), { code, status });
const digest = (value) => createHash("sha256").update(value).digest("hex");

/** Synchronous atomic transactions serialize append/version updates within the Host process. */
export function createVoiceRecords({ directory = join(dshHome(), "voice-records"), now = Date.now } = {}) {
  const path = (owner, conversation) => {
    if (typeof owner !== "string" || !owner || typeof conversation !== "string" || !conversation || conversation.length > 256) throw failure("voice_records_invalid");
    return join(directory, digest(owner), `${digest(conversation)}.json`);
  };
  const read = (owner, conversation) => {
    const file = path(owner, conversation);
    if (!existsSync(file)) return { version: 0, records: [], summary: null };
    // Corrupt history is explicit; never overwrite it with an empty conversation.
    let value;
    try { value = JSON.parse(readFileSync(file, "utf8")); } catch { throw failure("voice_records_corrupt", 500); }
    if (!Number.isInteger(value.version) || !Array.isArray(value.records)) throw failure("voice_records_corrupt", 500);
    return value;
  };
  const listeners = new Map();
  const publish = (owner, conversation) => { for (const notify of listeners.get(path(owner, conversation)) || []) notify(); };
  return {
    read,
    subscribe(owner, conversation, notify) {
      const key = path(owner, conversation);
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(notify);
      return () => { const set = listeners.get(key); set?.delete(notify); if (!set?.size) listeners.delete(key); };
    },
    page(owner, conversation, { after = 0, limit = 100 } = {}) {
      if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw failure("voice_records_invalid");
      const value = read(owner, conversation);
      const rows = value.records.map((row, index) => ({ ...row, sequence: row.sequence || index + 1 })).filter((row) => row.sequence > after);
      const page = rows.slice(0, limit);
      return { version: value.version, records: page, next: rows.length > limit ? page.at(-1).sequence : null };
    },
    bind(owner, contextId, sessionId) {
      const key = `voice:${contextId}`;
      const value = read(owner, key);
      value.binding = sessionId;
      writeJsonFile(path(owner, key), value);
    },
    append(owner, conversation, record) {
      if (!record || !["user", "assistant", "task"].includes(record.role) || typeof record.text !== "string" || record.text.length > 16000 || typeof record.voiceId !== "string" || typeof record.turnId !== "string") throw failure("voice_records_invalid");
      const value = read(owner, conversation);
      const index = value.records.findIndex((item) => item.id === record.id);
      if (typeof record.id !== "string" || !record.id || (index < 0 && value.records.length >= 10000)) throw failure("voice_records_limit", 409);
      // Copy only public record fields; audio, credentials and arbitrary tool payloads cannot enter storage.
      const previous = value.records[index];
      const next = { id: record.id, voiceId: record.voiceId, clientId: String(record.clientId || "").slice(0, 128), turnId: record.turnId, role: record.role, text: record.text,
        taskId: record.taskId || null, requestId: record.requestId || record.taskId || record.turnId,
        taskTurn: Number.isInteger(record.taskTurn) ? record.taskTurn : null,
        anchorSeq: previous?.anchorSeq ?? (Number.isInteger(record.anchorSeq) ? record.anchorSeq : -1),
        status: ["streaming", "failed", "truncated"].includes(record.status) ? record.status : "completed",
        sequence: previous?.sequence || (index >= 0 ? index + 1 : value.records.length + 1), at: previous?.at || now() };
      if (previous && JSON.stringify(previous) === JSON.stringify(next)) return value;
      if (index < 0) value.records.push(next); else value.records[index] = next;
      value.version++;
      value.summary = { text: value.summary?.text, textVersion: value.summary?.textVersion, version: value.version, source: record.voiceId,
        recent: value.records.slice(-12).map(({ role, text, taskId }) => ({ role, text, taskId })),
        tasks: [...new Set(value.records.map((item) => item.taskId).filter(Boolean))].slice(-64) };
      writeJsonFile(path(owner, conversation), value);
      publish(owner, conversation);
      return value;
    },
    checkpoint(owner, conversation, summary, expectedVersion) {
      const value = read(owner, conversation);
      if (value.version !== expectedVersion) throw failure("voice_summary_conflict", 409);
      if (typeof summary !== "string" || summary.length > 16000) throw failure("voice_records_invalid");
      value.summary = { ...value.summary, text: summary, textVersion: value.version, version: value.version };
      writeJsonFile(path(owner, conversation), value);
      return value;
    },
    clearConversation(conversation) {
      if (!existsSync(directory)) return;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)) {
          const folder = join(directory, entry.name);
          rmSync(join(folder, `${digest(conversation)}.json`), { force: true });
          for (const file of readdirSync(folder)) {
            if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
            const candidate = join(folder, file);
            let value; try { value = JSON.parse(readFileSync(candidate, "utf8")); } catch { continue; }
            if (value.binding === conversation) rmSync(candidate, { force: true });
          }
        }
      }
    },
    clear(owner, conversation) { rmSync(path(owner, conversation), { force: true }); publish(owner, conversation); },
  };
}
