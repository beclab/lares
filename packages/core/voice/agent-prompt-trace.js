import { createHash } from "node:crypto";

const short = (value) => createHash("sha1").update(typeof value === "string" ? value : JSON.stringify(value ?? null)).digest("hex").slice(0, 8);

/**
 * What a device-driven Agent Session sends its model, reduced to what decides the engine's prefix
 * cache: on the robot a light request after a weather lookup re-read all 30k tokens (sglang cached
 * none of them) while the next request reused 30k, and nothing said which part had changed.
 *
 * `rule` records once per Session, and again when it changes, whether the device or the voice
 * spoken-reply rule applies; `assembled` the system prompt's section, context and tool hashes,
 * naming the parts that changed since the Session's last assembly; `request` the first message of
 * a model request that differs from the Session's previous request, with its role and the shape of
 * both versions (null while the conversation only grew). Only hashes, roles, keys and lengths are
 * reported, never content.
 */
export function createAgentPromptTrace({ report, limit = 256 }) {
  const rules = new Map(), prompts = new Map(), histories = new Map();
  const remember = (map, key, value) => { map.delete(key); map.set(key, value); if (map.size > limit) map.delete(map.keys().next().value); };
  return {
    rule(sessionId, device, voice) {
      const value = `${device}:${voice}`;
      if (!sessionId || rules.get(sessionId) === value) return;
      remember(rules, sessionId, value);
      report({ event: "agent-prompt-rule", sessionId, device, voice });
    },
    assembled(sessionId, assembly, { deviceRule = false } = {}) {
      const parts = {
        ...Object.fromEntries((assembly.sections || []).map((section) => [`section:${section.name}`, short(section.text)])),
        ...Object.fromEntries((assembly.contexts || []).map((context) => [`context:${context.name}`, short(context.text)])),
        tools: short((assembly.tools || []).map((tool) => tool?.name ?? tool?.function?.name ?? tool)),
      };
      const before = prompts.get(sessionId);
      remember(prompts, sessionId, parts);
      const changed = before ? Object.keys({ ...before, ...parts }).filter((key) => before[key] !== parts[key]) : null;
      if (before && !changed.length) return;
      report({ event: "agent-prompt", sessionId, deviceRule, first: !before, changed: changed || [], sections: (assembly.sections || []).length, chars: (assembly.sections || []).reduce((sum, section) => sum + String(section.text || "").length, 0), parts });
    },
    request(sessionId, messages) {
      const shape = (message) => ({ role: message?.role ?? null, keys: Object.keys(message || {}).sort().join(","), chars: JSON.stringify(message ?? null).length });
      const now = (messages || []).map((message) => ({ hash: short(message), ...shape(message) }));
      const before = histories.get(sessionId);
      remember(histories, sessionId, now);
      let index = null;
      if (before) for (let i = 0; i < Math.min(before.length, now.length); i++) if (before[i].hash !== now[i].hash) { index = i; break; }
      if (before && index === null && now.length < before.length) index = now.length;
      const was = index === null ? null : before[index] ?? null, is = index === null ? null : now[index] ?? null;
      report({ event: "agent-request", sessionId, messages: now.length, previous: before?.length ?? null, firstChanged: index,
        ...(index === null ? {} : { changedRole: is?.role ?? was?.role ?? null, before: was && { keys: was.keys, chars: was.chars }, after: is && { keys: is.keys, chars: is.chars } }) });
    },
  };
}
