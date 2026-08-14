import {
  ensureCliProfile,
  identityAvailable,
} from "./identity.js";

/** @type {Map<string, import('./identity.js').OlaresIdentity>} */
const bySession = new Map();

/** @type {import('./identity.js').OlaresIdentity | null} */
let latest = null;

/**
 * Remember edge identity and materialize olares-cli profile env so subsequent
 * bash calls inherit HOME / OLARES_CLI_* (dsh scrub keeps non-DSH_* parent env).
 * Olares app pods are per-user; process.env is the jarvis-aligned cold path.
 *
 * @param {string} sessionId
 * @param {import('./identity.js').OlaresIdentity} identity
 */
export function rememberSessionIdentity(sessionId, identity) {
  if (sessionId) bySession.set(sessionId, identity);
  latest = identity;
  if (!identityAvailable(identity)) return;
  const profile = ensureCliProfile(identity);
  Object.assign(process.env, profile.env);
}

/**
 * Apply identity from a browser request when no session id is known yet.
 * @param {import('./identity.js').OlaresIdentity} identity
 */
export function rememberRequestIdentity(identity) {
  latest = identity;
  if (!identityAvailable(identity)) return;
  const profile = ensureCliProfile(identity);
  Object.assign(process.env, profile.env);
}

/** @param {string} sessionId */
export function getSessionIdentity(sessionId) {
  return bySession.get(sessionId) ?? null;
}

export function getLatestIdentity() {
  return latest;
}

/** @param {string} sessionId */
export function forgetSessionIdentity(sessionId) {
  bySession.delete(sessionId);
}
