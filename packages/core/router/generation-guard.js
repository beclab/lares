/**
 * Keep the agent from generating on FlowStudio around the in-process shim.
 *
 * Only the shim (`$LARES_LLM_BASE_URL`, also what `olares-cli router call` and
 * the `media_generate` tool use) stamps the logged-in user as an encrypted
 * `sref`. A shell call straight to Router's data plane or to FlowStudio lands
 * the job, and its files, under the shared chart owner instead, where this
 * user cannot open them. This is a text check on what the agent is about to
 * run: it stops the obvious routes the skills used to allow, and the skills
 * say the same thing in words.
 */

const GENERATION_PATH =
  /\/(?:v1\/)?(?:images\/generations|images\/edits|videos|music\/generations|generations)(?![a-z0-9_-])/i;

/** FlowStudio's own API or service, which no skill has a reason to call directly. */
const FLOWSTUDIO_DIRECT = [
  /flowstudio-svc/i,
  /flowstudio-shared/i,
  /\/api\/v1\/generations/i,
  /\/api\/jobs(?![a-z0-9_-])/i,
  /\/api\/projects\/[^\s"']*\/(?:run|jobs|generate)/i,
];

const ROUTER_VARIABLE = /\$\{?LLM_GATEWAY_URL\}?/;
const ROUTER_SERVICE = /router-svc(?:\.router-shared)?/i;

export const GENERATION_BYPASS_REASON =
  "Generate through the media_generate tool or $LARES_LLM_BASE_URL (the in-process Router shim) only. " +
  "A direct call to Router's data plane or to FlowStudio files the job under the shared app owner, " +
  "so this user can neither see the job nor open its files. Do not retry another way; " +
  "if the shim is unavailable, tell the user generation is unavailable right now.";

function routerHosts(env) {
  const hosts = [];
  try {
    const raw = env.LLM_GATEWAY_URL?.trim();
    if (raw) hosts.push(new URL(raw).host.toLowerCase());
  } catch {
    // An unparsable gateway URL only removes one pattern; the others still apply.
  }
  return hosts;
}

function mentionsRouter(text, env) {
  if (ROUTER_VARIABLE.test(text) || ROUTER_SERVICE.test(text)) return true;
  const lower = text.toLowerCase();
  return routerHosts(env).some((host) => lower.includes(host));
}

/**
 * @param {string} text a shell command, code snippet, or URL the agent will run
 * @returns {string | null} the refusal reason, or null when the text is fine
 */
export function detectGenerationBypass(text, env = process.env) {
  if (typeof text !== "string" || text.trim() === "") return null;
  if (FLOWSTUDIO_DIRECT.some((pattern) => pattern.test(text))) return GENERATION_BYPASS_REASON;
  if (mentionsRouter(text, env) && GENERATION_PATH.test(text)) return GENERATION_BYPASS_REASON;
  return null;
}

/** Tools whose arguments are something the agent executes or fetches. */
const GUARDED_TOOLS = new Map([
  ["bash", ["command"]],
  ["pwsh", ["command"]],
  ["web_fetch", ["url"]],
]);

/**
 * Pre-execute decision for one tool call; `prior` is what later listeners decided.
 * @returns {{ kind: string, reason?: string }}
 */
export function decideGenerationGuard({ name, args, prior }, env = process.env) {
  if (prior && prior.kind === "deny") return prior;
  const fields = GUARDED_TOOLS.get(name);
  if (!fields || args == null || typeof args !== "object") return prior;
  for (const field of fields) {
    const reason = detectGenerationBypass(args[field], env);
    if (reason) return { kind: "deny", reason };
  }
  return prior;
}
