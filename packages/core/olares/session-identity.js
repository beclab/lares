import { olaresUsername } from "./identity.js";

/** @type {Map<string, import('./identity.js').OlaresIdentity>} */
const bySession = new Map();

/** @type {import('./identity.js').OlaresIdentity | null} */
let latest = null;

/**
 * The Router end user for calls that carry no request of their own. The
 * olares-cli session is not set up here: it comes from the credential
 * app-service mounts, which already names the full Olares ID.
 *
 * @param {import('./identity.js').OlaresIdentity} identity
 */
function applyIdentityEnv(identity) {
  const user = olaresUsername(identity.user);
  if (user) process.env.OLARES_USERNAME = user;
}

export function rememberSessionIdentity(sessionId, identity) {
  if (sessionId) bySession.set(sessionId, identity);
  latest = identity;
  applyIdentityEnv(identity);
}

/**
 * Apply identity from a browser request when no session id is known yet.
 * @param {import('./identity.js').OlaresIdentity} identity
 */
export function rememberRequestIdentity(identity) {
  latest = identity;
  applyIdentityEnv(identity);
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
