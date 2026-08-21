/** The model facts Dina's settings panel reads and writes. */
import { routerCatalogRows } from "../../shared/host/router-catalog.js";

const PROVIDER = "olares-router";
const SETTINGS_NS = "llm-pi-ai";
const NON_CHAT_HINTS = /embed|whisper|tts|speech|ocr|clip|stt|asr|transcri/i;
const PLACEHOLDER_MODEL = /^(?:default|deepseek-v4-(?:flash|pro))$/i;

/** @param {unknown} err */
function messageOf(err) {
  return err instanceof Error ? err.message : String(err);
}

/** @param {string} code @param {number} status @param {string} message */
function failure(code, status, message) {
  return Object.assign(new Error(message), { code, status });
}

function shimBaseUrl() {
  const configured = process.env.DINA_LLM_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `http://127.0.0.1:${process.env.PORT ?? 8080}/llm/v1`;
}

/** @param {unknown} payload */
export function chatModelsFromRouterCatalog(payload) {
  return routerCatalogRows(payload)
    .filter((model) => model.mode ? model.mode === "chat" : !NON_CHAT_HINTS.test(model.id))
    .map(({ id, name, reasoningEfforts }) => ({
      id,
      name,
      ...(reasoningEfforts === null ? {} : { reasoningEfforts }),
    }));
}

/**
 * Pull Router's live catalog into the llm-pi-ai route. The settings write
 * re-registers the adapter, so the returned panel and the next LLM call see the
 * same model set.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
async function performRefresh(ctx) {
  const response = await fetch(`${shimBaseUrl()}/models`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw failure("router_unavailable", 503, `Router /models returned ${response.status}`);
  }
  const models = chatModelsFromRouterCatalog(await response.json());
  await ctx.settings.mutate(SETTINGS_NS, [
    { op: "set", path: ["providers", PROVIDER, "models"], value: models },
  ]);

  const current = currentDefault(ctx);
  if (models.length > 0 && (current.provider !== PROVIDER || !models.some((model) => model.id === current.model))) {
    await ctx.agentDefaultModel.saveSelection({ provider: PROVIDER, model: pickDefaultModel(models).id });
  }
  return models;
}

/** @type {Promise<{ id: string, name: string }[]> | null} */
let refreshInFlight = null;

/** Coalesce concurrent refresh requests so catalog/default updates cannot interleave. */
export function refreshCatalog(ctx) {
  if (refreshInFlight) return refreshInFlight;
  const operation = performRefresh(ctx);
  const shared = operation.finally(() => {
    if (refreshInFlight === shared) refreshInFlight = null;
  });
  refreshInFlight = shared;
  return shared;
}

/** Prefer Router's faster MTP build, matching the boot-time default policy. */
export function pickDefaultModel(models) {
  return models.find((model) => /\bmtp\b/i.test(model.id)) ?? models[0] ?? null;
}

/**
 * Router chat models the Host can route.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @returns {Promise<{ models: object[], failures: object[] }>}
 */
export async function listCatalog(ctx) {
  const models = [];
  const failures = [];
  const provider = ctx.llm.listProviders().find((entry) => entry.id === PROVIDER);
  if (!provider) {
    return {
      models,
      failures: [{ provider: PROVIDER, name: "Olares Router", message: "provider is not registered" }],
    };
  }
  try {
    for (const model of await ctx.llm.listModels(PROVIDER)) {
      if (PLACEHOLDER_MODEL.test(model.id.trim())) continue;
      models.push({
        provider: PROVIDER,
        providerName: provider.name,
        id: model.id,
        name: model.name || model.id,
        ...(model.description ? { description: model.description } : {}),
      });
    }
  } catch (err) {
    failures.push({ provider: PROVIDER, name: provider.name, message: messageOf(err) });
  }
  return { models, failures };
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @returns {{ provider: string, model: string }}
 */
export function currentDefault(ctx) {
  const { provider, model } = ctx.agentDefaultModel.currentSelection();
  return { provider, model };
}

/**
 * Save what future sessions start from — the same `agent-default-model` section
 * the composer chip writes when it switches a session.
 *
 * No reasoning effort travels with the selection: the Router route declares its
 * models by hand, and a hand-declared model rejects every explicit level.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ provider?: unknown, model?: unknown }} request
 * @returns {Promise<{ provider: string, model: string }>}
 */
export async function saveDefault(ctx, request) {
  const model = typeof request?.model === "string" ? request.model.trim() : "";
  if (!model) throw failure("bad_request", 400, "model is required");
  const asked = typeof request?.provider === "string" ? request.provider.trim() : "";
  if (asked && asked !== PROVIDER) {
    throw failure("bad_request", 400, "provider must be olares-router");
  }
  if (PLACEHOLDER_MODEL.test(model)) {
    throw failure("model_unavailable", 400, "Router has no configured chat model");
  }

  let resolved;
  try {
    resolved = await ctx.llm.resolveCallConfig({ provider: PROVIDER, model });
  } catch (err) {
    throw failure("model_unavailable", 400, messageOf(err));
  }
  await ctx.agentDefaultModel.saveSelection({ provider: resolved.provider, model: resolved.model });
  return { provider: resolved.provider, model: resolved.model };
}
