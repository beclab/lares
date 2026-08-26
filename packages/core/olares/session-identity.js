import {
  ensureCliProfile,
  identityAvailable,
} from "./identity.js";

/** @type {Map<string, import('./identity.js').OlaresIdentity>} */
const bySession = new Map();

/** @type {import('./identity.js').OlaresIdentity | null} */
let latest = null;

/**
 * Cache edge identity and materialize olares-cli env (HOME / OLARES_CLI_*) for bash.
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
