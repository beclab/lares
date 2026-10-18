import { resolveDefaultSelection } from "@olares/lares-core/router/default-selection";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Document, isSeq, parseDocument } from "yaml";
import {
  ROUTER_RETRY_POLICY,
  isChatModel,
  type RouterModelEntry,
} from "./router-models.js";

/** The provider route Lares owns: a pi-ai profile key, and what agent-default-model names. */
const PROVIDER = "olares-router";
const DISPLAY_NAME = "Olares Router";
/**
 * Router is reached through pi-ai rather than a Lares-owned adapter because the
 * web Models page only offers its model-list editor and endpoint interrogation
 * to the `llm-pi-ai` and `llm-deepseek` namespaces; any other namespace renders
 * a "edit the configuration file" hint. The route lives in the user's settings
 * document, so the page owns it from the first boot onwards.
 */
const SETTINGS_NS = "llm-pi-ai";
/** Router relays OpenAI-compatible chat completions; thinking arrives as `reasoning_content`. */
const PROTOCOL = "openai-completions";
/**
 * Reasoning dispatch the Router accepts: a plain `reasoning_effort`, and no
 * `thinkingFormat` — naming one would wrap the level in a vendor envelope the
 * gateway never asked for. Which models offer a level is the catalog's word,
 * carried per model in `reasoningEfforts`.
 */
const ROUTE_COMPAT = {
  supportsReasoningEffort: true,
  // pi-ai adds `store: false` unless this is false, and it decides that from
  // the route base URL. The URL is the local shim, so Google's rejection
  // (`Unknown name "store"`) never shows up in detection. Omitting the field
  // matches OpenAI's own default of false.
  supportsStore: false,
};
/**
 * The shim bearer's credential reference — never LARES_ROUTER_API_KEY. The
 * /llm/v1 shim strips whatever Authorization the adapter sends and attaches
 * Router's own app identity, while pi-ai still requires the route's named
 * credential to resolve; keeping the two apart means a user's real Router key
 * stays the shim's business.
 */
const CREDENTIAL_REF = "LARES_ROUTER_SHIM_KEY";

export interface LaresSettingsSeed {
  /** Last authorized catalog returned at boot. */
  catalog: RouterModelEntry[];
  catalogLoaded?: boolean;
  /** The local shim endpoint pi-ai calls (chat completions and /models). */
  baseURL: string;
}

export interface LaresSettingsResult {
  /** The model agent-default-model now names, or null when nothing could be chosen. */
  model: string | null;
  /** Whether this boot created the Router route (absent profile). */
  routeSeeded: boolean;
  /** How many models the route declares to the picker after this boot. */
  routeModels: number;
  /** Whether the document was rewritten. */
  changed: boolean;
}

/**
 * Reconcile $DSH_HOME/settings.yaml with the Router: seed the provider route
 * once, then mirror availability and initialize a usable default for new sessions.
 *
 * The composition patch cannot do this job: a user-layer settings document
 * overrides it, and the Models page writes only that document.
 * @param dshHome - the dsh home whose settings.yaml is reconciled.
 * @param seed - Router facts for this boot.
 * @returns what the document names now, and whether it was written.
 */
export function bootstrapLaresSettings(dshHome: string, seed: LaresSettingsSeed): LaresSettingsResult {
  mkdirSync(dshHome, { recursive: true });
  const settingsPath = join(dshHome, "settings.yaml");
  const raw = readSettings(settingsPath);
  const doc = parseDocument(raw);

  const routeSeeded = seedRouterRoute(doc, seed);
  if (!routeSeeded) refreshRouterRoute(doc, seed);
  const model = pinDefaultModel(doc, seed);
  const routeModels = declaredModelCount(doc);

  const next = doc.toString();
  if (next === raw) return { model, routeSeeded: false, routeModels, changed: false };
  const tmp = `${settingsPath}.${process.pid}.tmp`;
  writeFileSync(tmp, next, { mode: 0o600 });
  renameSync(tmp, settingsPath);
  return { model, routeSeeded, routeModels, changed: true };
}

function readSettings(settingsPath: string): string {
  if (!existsSync(settingsPath)) return "";
  try {
    return readFileSync(settingsPath, "utf8");
  } catch {
    return "";
  }
}

/**
 * Create the Router profile when the document has none. Endpoint, display name,
 * and every other field on an existing profile stay the user's — the Models
 * page edits them and a boot-time refresh would undo those edits.
 * @returns whether the profile was created.
 */
function seedRouterRoute(doc: Document, seed: LaresSettingsSeed): boolean {
  const path = [SETTINGS_NS, "providers", PROVIDER];
  if (doc.getIn(path) !== undefined) return false;

  const chat = declarableModels(seed);
  const models = chat;

  doc.setIn(path, {
    displayName: DISPLAY_NAME,
    api: PROTOCOL,
    baseURL: seed.baseURL,
    apiKeyEnv: CREDENTIAL_REF,
    compat: ROUTE_COMPAT,
    retryPolicy: structuredClone(ROUTER_RETRY_POLICY),
    models,
  });
  return true;
}

/**
 * Mirror the Router catalog into the route. Model list and reasoning switches
 * are derived state, not user preferences: Router alone decides which models
 * exist and which of them take an effort level, and a list written once at seed
 * time strands the picker on whatever that boot saw — a lone `default`
 * placeholder when the catalog was still unreachable. Only a failed read preserves the previous list; a successful empty list clears it.
 */
function refreshRouterRoute(doc: Document, seed: LaresSettingsSeed): void {
  const path = [SETTINGS_NS, "providers", PROVIDER];
  doc.setIn([...path, "compat"], ROUTE_COMPAT);
  doc.setIn([...path, "retryPolicy"], structuredClone(ROUTER_RETRY_POLICY));
  const chat = declarableModels(seed);
  if (seed.catalogLoaded === false) return;
  doc.setIn([...path, "models"], chat);
}

interface RouteModel {
  id: string;
  name: string;
  input?: ["text", "image"];
  reasoningEfforts?: Record<string, string>;
  contextWindow?: number;
  maxTokens?: number;
}

/**
 * Embedding, transcription, and OCR rows share the Router catalog but cannot
 * serve a chat turn; declaring them would only put dead entries in the picker.
 *
 * The sizes are declared for the same reason the model list is: pi-ai has no
 * catalog entry for a Router id, so a model that omits them is sized by the
 * route default of 262144 tokens rather than by the engine actually serving it.
 */
function declarableModels(seed: LaresSettingsSeed): RouteModel[] {
  return seed.catalog.filter(isChatModel).map((entry) => ({
    id: entry.id,
    name: entry.name,
    ...(entry.supportsVision ? { input: ["text", "image"] as ["text", "image"] } : {}),
    ...(entry.reasoningEfforts ? { reasoningEfforts: entry.reasoningEfforts } : {}),
    ...(entry.contextWindow === null ? {} : { contextWindow: entry.contextWindow }),
    ...(entry.maxTokens === null ? {} : { maxTokens: entry.maxTokens }),
  }));
}

function declaredModelCount(doc: Document): number {
  // A list this boot wrote is still the plain array setIn stored; a parsed one
  // is a node.
  const models: unknown = doc.getIn([SETTINGS_NS, "providers", PROVIDER, "models"]);
  if (isSeq(models)) return models.items.length;
  return Array.isArray(models) ? models.length : 0;
}

/** Existing session selections are stored separately from this new-session default. */
function pinDefaultModel(doc: Document, seed: LaresSettingsSeed): string | null {
  const current = {
    provider: readString(doc, ["agent-default-model", "provider"]) ?? PROVIDER,
    model: readString(doc, ["agent-default-model", "model"]) ?? "",
  };
  const next = seed.catalogLoaded === false ? current : resolveDefaultSelection(current, declarableModels(seed));
  if (next !== current) doc.setIn(["agent-default-model"], next);
  else if (!current.model) {
    doc.setIn(["agent-default-model", "provider"], current.provider);
    doc.setIn(["agent-default-model", "model"], "");
  }
  return next.model || null;
}

function readString(doc: Document, path: string[]): string | null {
  const value = doc.getIn(path);
  return typeof value === "string" && value.trim() ? value : null;
}

export const ROUTER_CREDENTIAL_REF = CREDENTIAL_REF;
export const ROUTER_PROVIDER = PROVIDER;
