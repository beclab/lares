import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isPlaceholderModelId, type RouterModelEntry } from "./router-models.js";

const PROVIDER = "deepseek-official";

/**
 * Seed / refresh $DSH_HOME/settings.yaml agent-default-model from Router catalog.
 * Composition patch alone is not enough when a user-layer settings file already exists.
 */
export function bootstrapAgentDefaultModel(
  dshHome: string,
  catalog: RouterModelEntry[],
  envDefaultModel: string | null,
  chatFallback: string | null,
): { model: string | null; changed: boolean } {
  const desired = (envDefaultModel && !isPlaceholderModelId(envDefaultModel) ? envDefaultModel : null)
    ?? chatFallback;
  if (!desired) return { model: null, changed: false };

  mkdirSync(dshHome, { recursive: true });
  const settingsPath = join(dshHome, "settings.yaml");
  let raw = "";
  if (existsSync(settingsPath)) {
    try {
      raw = readFileSync(settingsPath, "utf8");
    } catch {
      raw = "";
    }
  }

  const current = readYamlModel(raw);
  const catalogIds = new Set(catalog.map((m) => m.id));
  const currentIsStale =
    isPlaceholderModelId(current.model)
    || (catalogIds.size > 0 && current.model !== null && !catalogIds.has(current.model));
  const envForcesUpdate = Boolean(envDefaultModel && envDefaultModel !== current.model);

  if (current.model === desired && !envForcesUpdate) {
    return { model: desired, changed: false };
  }
  if (!currentIsStale && !envForcesUpdate && current.model) {
    return { model: current.model, changed: false };
  }

  const next = writeAgentDefaultModelYaml(raw, {
    provider: PROVIDER,
    model: desired,
    reasoningEffort: current.reasoningEffort,
  });
  const tmp = `${settingsPath}.${process.pid}.tmp`;
  writeFileSync(tmp, next, { mode: 0o600 });
  renameSync(tmp, settingsPath);
  return { model: desired, changed: true };
}

function readYamlModel(raw: string): {
  model: string | null;
  reasoningEffort: string | null;
} {
  const section = raw.match(/^agent-default-model:\n((?:[ \t]+.*\n?)*)/m);
  if (!section) return { model: null, reasoningEffort: null };
  const body = section[1] ?? "";
  const model = body.match(/^[ \t]+model:\s*(.+)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, "").trim() ?? null;
  const reasoningEffort =
    body.match(/^[ \t]+reasoningEffort:\s*(.+)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, "").trim() ?? null;
  return { model, reasoningEffort };
}

function writeAgentDefaultModelYaml(
  raw: string,
  next: { provider: string; model: string; reasoningEffort: string | null },
): string {
  const block = [
    "agent-default-model:",
    `  provider: ${next.provider}`,
    `  model: ${JSON.stringify(next.model)}`,
    ...(next.reasoningEffort ? [`  reasoningEffort: ${next.reasoningEffort}`] : []),
    "",
  ].join("\n");

  if (/^agent-default-model:\n(?:[ \t]+.*\n?)*/m.test(raw)) {
    return raw.replace(/^agent-default-model:\n(?:[ \t]+.*\n?)*/m, block);
  }
  const trimmed = raw.trimEnd();
  return trimmed ? `${trimmed}\n\n${block}` : block;
}
