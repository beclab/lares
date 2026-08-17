/**
 * Olares edge identity → olares-cli profile (from test_lares).
 * Access JWT only; no refresh. Commands work until the cookie expires.
 */
import { createCipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MASTER_KEY_BYTES = 32;
const IV_BYTES = 12;
const SERVICE = "olares-cli";

/**
 * @typedef {{ user: string, token: string, terminus: string }} OlaresIdentity
 */

/** @param {OlaresIdentity} identity */
export function identityAvailable(identity) {
  return Boolean(identity.user && identity.token && identity.terminus);
}

/** @param {string} cookieHeader */
function parseCookies(cookieHeader) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of cookieHeader.split(";")) {
    if (!part.includes("=")) continue;
    const [name, ...rest] = part.split("=");
    out[name.trim()] = rest.join("=").trim();
  }
  return out;
}

/** @param {string} user */
function userLabel(user) {
  return user.split("@", 1)[0]?.trim().toLowerCase() ?? "";
}

/**
 * @param {string} hostHeader
 * @param {string} user
 */
function terminusFromHost(hostHeader, user) {
  const host = hostHeader.trim().split(":")[0]?.toLowerCase() ?? "";
  const parts = host.split(".");
  if (parts.length < 3) return "";
  const terminus = parts.slice(1).join(".");
  const label = userLabel(user);
  if (!label || terminus.split(".", 1)[0] !== label) return "";
  return terminus;
}

/**
 * @param {import('node:http').IncomingHttpHeaders | Headers | Record<string, string | string[] | undefined>} headers
 * @param {string | null} [userDomain]
 * @returns {OlaresIdentity}
 */
export function identityFromHeaders(headers, userDomain) {
  const get = (name) => {
    if (typeof Headers !== "undefined" && headers instanceof Headers) {
      return headers.get(name) ?? "";
    }
    const raw = /** @type {Record<string, string | string[] | undefined>} */ (headers)[name]
      ?? /** @type {Record<string, string | string[] | undefined>} */ (headers)[name.toLowerCase()];
    if (Array.isArray(raw)) return raw.join(",");
    return raw ?? "";
  };

  const user = (
    get("remote-user")
    || get("authelia-remote-user")
    || get("x-bfl-user")
    || ""
  ).trim();

  const cookies = parseCookies(get("cookie"));
  let token = (cookies.auth_token ?? "").trim();
  if (!token) {
    const authorization = get("authorization").trim();
    if (authorization.toLowerCase().startsWith("bearer ")) {
      token = authorization.slice(7).trim();
    } else if (authorization) {
      token = authorization;
    }
  }
  if (!token) token = get("x-authorization").trim();

  let terminus = (userDomain ?? "").trim();
  if (!terminus) terminus = terminusFromHost(get("x-forwarded-host"), user);
  if (!terminus && user) terminus = `${userLabel(user)}.olares.com`;

  return { user, token, terminus };
}

/** @param {string} account */
function safeFileName(account) {
  return `${account.replace(/[^a-zA-Z0-9._-]/g, "_")}.enc`;
}

/**
 * @param {string} plaintext
 * @param {Buffer} key
 */
function encryptAesGcm(plaintext, key) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]);
}

/** @param {OlaresIdentity} identity */
function ownerHome(identity) {
  const root = (
    process.env.DINA_CLI_ROOT
    ?? process.env.OLARES_CLI_ROOT
    ?? "/data/cli"
  ).replace(/\/+$/, "");
  const label = userLabel(identity.user) || "anonymous";
  return join(root, label);
}

/**
 * Materialize per-user olares-cli profile + Linux file keychain from the edge
 * access token so bash/`olares-cli` authenticates without interactive login.
 *
 * @param {OlaresIdentity} identity
 */
export function ensureCliProfile(identity) {
  if (!identityAvailable(identity)) {
    throw new Error("Olares edge identity incomplete (need user + auth_token + terminus)");
  }

  const home = ownerHome(identity);
  const configDir = join(home, ".olares-cli");
  const dataDir = join(home, "keychain");
  const serviceDir = join(dataDir, SERVICE);
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  mkdirSync(serviceDir, { recursive: true, mode: 0o700 });

  const configPath = join(configDir, "config.json");
  const config = {
    currentProfile: identity.user,
    profiles: [
      {
        olaresId: identity.user,
        backendVersion: "1.12.7",
        backendVersionRefreshedAt: Math.floor(Date.now() / 1000),
      },
    ],
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

  const masterPath = join(serviceDir, "master.key");
  let master;
  if (existsSync(masterPath)) {
    master = readFileSync(masterPath);
    if (master.length !== MASTER_KEY_BYTES) {
      master = randomBytes(MASTER_KEY_BYTES);
      writeFileSync(masterPath, master, { mode: 0o600 });
    }
  } else {
    master = randomBytes(MASTER_KEY_BYTES);
    writeFileSync(masterPath, master, { mode: 0o600 });
  }

  const stored = {
    olaresId: identity.user,
    accessToken: identity.token,
    refreshToken: "",
    grantedAt: Date.now(),
    invalidatedAt: 0,
  };
  const enc = encryptAesGcm(JSON.stringify(stored), master);
  const tokenPath = join(serviceDir, safeFileName(identity.user));
  const tmp = `${tokenPath}.${process.pid}.tmp`;
  writeFileSync(tmp, enc, { mode: 0o600 });
  renameSync(tmp, tokenPath);

  return {
    home,
    dataDir,
    env: {
      HOME: home,
      OLARES_CLI_HOME: configDir,
      OLARES_CLI_DATA_DIR: dataDir,
      OLARES_CLI_REMOTE_ONLY: "1",
    },
  };
}
