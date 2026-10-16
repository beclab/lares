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
  return {
    read,
    bind(owner, contextId, sessionId) {
      const key = `voice:${contextId}`;
      const value = read(owner, key);
      value.binding = sessionId;
      writeJsonFile(path(owner, key), value);
    },
    append(owner, conversation, record) {
      if (!record || !["user", "assistant", "task"].includes(record.role) || typeof record.text !== "string" || record.text.length > 16000 || typeof record.voiceId !== "string" || typeof record.turnId !== "string") throw failure("voice_records_invalid");
      const value = read(owner, conversation);
      if (value.records.some((item) => item.id === record.id)) return value;
      if (typeof record.id !== "string" || !record.id || value.records.length >= 10000) throw failure("voice_records_limit", 409);
      // Copy only public record fields; audio, credentials and arbitrary tool payloads cannot enter storage.
      value.records.push({ id: record.id, voiceId: record.voiceId, clientId: String(record.clientId || "").slice(0, 128), turnId: record.turnId, role: record.role, text: record.text, taskId: record.taskId || null, at: now() });
      value.version++;
      value.summary = { text: value.summary?.text, textVersion: value.summary?.textVersion, version: value.version, source: record.voiceId,
        recent: value.records.slice(-12).map(({ role, text, taskId }) => ({ role, text, taskId })),
        tasks: [...new Set(value.records.map((item) => item.taskId).filter(Boolean))].slice(-64) };
      writeJsonFile(path(owner, conversation), value);
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
    clear(owner, conversation) { rmSync(path(owner, conversation), { force: true }); },
  };
}
