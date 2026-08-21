import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Document, isSeq, parseDocument } from "yaml";
import { isChatModel, isPlaceholderModelId, type RouterModelEntry } from "./router-models.js";

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
const ROUTE_COMPAT = { supportsReasoningEffort: true };
/**
 * The shim bearer's credential reference — never LARES_ROUTER_API_KEY. The
 * /llm/v1 shim strips whatever Authorization the adapter sends and attaches
 * Router's own app identity, while pi-ai still requires the route's named
 * credential to resolve; keeping the two apart means a user's real Router key
 * stays the shim's business.
 */
const CREDENTIAL_REF = "LARES_ROUTER_SHIM_KEY";

export interface LaresSettingsSeed {
  /** Router catalog, empty when the catalog could not be read this boot. */
  catalog: RouterModelEntry[];
  /** The local shim endpoint pi-ai calls (chat completions and /models). */
  baseURL: string;
  /** Catalog chat pick used when nothing is saved or the saved id is stale. */
  chatFallback: string | null;
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
 * once, then keep the default model pointing at something the Router serves.
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
  const fallbackId = desiredModel(seed) ?? "default";
  const models = chat.length > 0 ? chat : [{ id: fallbackId, name: fallbackId }];

  doc.setIn(path, {
    displayName: DISPLAY_NAME,
    api: PROTOCOL,
    baseURL: seed.baseURL,
    apiKeyEnv: CREDENTIAL_REF,
    compat: ROUTE_COMPAT,
    models,
  });
  return true;
}

/**
 * Mirror the Router catalog into the route. Model list and reasoning switches
 * are derived state, not user preferences: Router alone decides which models
 * exist and which of them take an effort level, and a list written once at seed
 * time strands the picker on whatever that boot saw — a lone `default`
 * placeholder when the catalog was still unreachable. An empty catalog means
 * this boot could not read Router, so the list stands.
 */
function refreshRouterRoute(doc: Document, seed: LaresSettingsSeed): void {
  const path = [SETTINGS_NS, "providers", PROVIDER];
  doc.setIn([...path, "compat"], ROUTE_COMPAT);
  const chat = declarableModels(seed);
  if (chat.length === 0) return;
  doc.setIn([...path, "models"], chat);
}

interface RouteModel {
  id: string;
  name: string;
  reasoningEfforts?: Record<string, string>;
}

/**
 * Embedding, transcription, and OCR rows share the Router catalog but cannot
 * serve a chat turn; declaring them would only put dead entries in the picker.
 */
function declarableModels(seed: LaresSettingsSeed): RouteModel[] {
  return seed.catalog.filter(isChatModel).map((entry) => ({
    id: entry.id,
    name: entry.name,
    ...(entry.reasoningEfforts ? { reasoningEfforts: entry.reasoningEfforts } : {}),
  }));
}

function declaredModelCount(doc: Document): number {
  // A list this boot wrote is still the plain array setIn stored; a parsed one
  // is a node.
  const models: unknown = doc.getIn([SETTINGS_NS, "providers", PROVIDER, "models"]);
  if (isSeq(models)) return models.items.length;
  return Array.isArray(models) ? models.length : 0;
}

/**
 * Point agent-default-model at this provider and a model the Router still
 * offers. A saved model the catalog still lists is the user's choice; the
 * provider route is ours, so a stale one is corrected under whichever model
 * stands.
 * @returns the model the document names now.
 */
function pinDefaultModel(doc: Document, seed: LaresSettingsSeed): string | null {
  const current = readString(doc, ["agent-default-model", "model"]);
  const desired = desiredModel(seed);
  const catalogIds = new Set(seed.catalog.filter(isChatModel).map((entry) => entry.id));
  const stale = isPlaceholderModelId(current)
    || (catalogIds.size > 0 && current !== null && !catalogIds.has(current));
  const model = current && !stale ? current : desired;
  if (model === null) return current;

  doc.setIn(["agent-default-model", "provider"], PROVIDER);
  doc.setIn(["agent-default-model", "model"], model);
  // Effort is the composer's per-session choice, and the levels differ per
  // model: a level named here outlives the model it was picked for and fails
  // the next request with UNSUPPORTED_REASONING_EFFORT.
  doc.deleteIn(["agent-default-model", "reasoningEffort"]);
  return model;
}

function desiredModel(seed: LaresSettingsSeed): string | null {
  return seed.chatFallback;
}

function readString(doc: Document, path: string[]): string | null {
  const value = doc.getIn(path);
  return typeof value === "string" && value.trim() ? value : null;
}

export const ROUTER_CREDENTIAL_REF = CREDENTIAL_REF;
export const ROUTER_PROVIDER = PROVIDER;
