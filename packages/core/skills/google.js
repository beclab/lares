import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { HttpError } from "../tools/http.js";
import { readJsonFile, writeJsonFile } from "../tools/json-file.js";
import { googleBin, googleHome } from "./google-install.js";
import { runProcess } from "./process.js";

export const GOOGLE_SERVICES = ["gmail", "calendar", "drive", "docs", "sheets", "slides"];
const locks = new Set();
const stateFile = (dir) => join(googleHome(dir), "connection.json");
const pendingFile = (dir) => join(googleHome(dir), "pending.json");
const keyFile = (dir) => join(googleHome(dir), "keyring-password");

export async function withGoogleLock(dir, operation) {
  const key = resolve(dir);
  if (locks.has(key)) throw new HttpError("google_busy", 409, "Another Google Workspace operation is running");
  locks.add(key);
  try { return await operation(); } finally { locks.delete(key); }
}
export function googleEnvironment(dir) {
  const home = googleHome(dir);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (!existsSync(keyFile(dir))) writeFileSync(keyFile(dir), randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
  // Inherited auth overrides must not route this plugin to another identity.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GOG_")));
  return { ...env, GOG_HOME: home, GOG_CLIENT: "lares", GOG_KEYRING_BACKEND: "file", GOG_KEYRING_PASSWORD: readFileSync(keyFile(dir), "utf8").trim() };
}
export function validateGoogleClient(raw) {
  let value;
  try { value = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { /* Public error below omits the input. */ }
  const item = value?.installed;
  if (!item || typeof item.client_id !== "string" || !/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(item.client_id)
      || typeof item.client_secret !== "string" || !item.client_secret.trim() || item.client_secret.length > 4096) {
    throw new HttpError("invalid_google_client", 400, "Import a Desktop app OAuth client JSON downloaded from Google Cloud Console");
  }
  return { installed: { client_id: item.client_id, client_secret: item.client_secret, auth_uri: "https://accounts.google.com/o/oauth2/auth", token_uri: "https://oauth2.googleapis.com/token", redirect_uris: ["http://localhost"] } };
}
export function googleEmail(raw) {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || email.startsWith("-")) {
    throw new HttpError("bad_request", 400, "A Google account email is required");
  }
  return email;
}
function clearPending(dir) {
  rmSync(pendingFile(dir), { force: true });
  // gog persists its PKCE verifier separately; invalidating a flow removes it too.
  for (const folder of [join(googleHome(dir), "config"), join(googleHome(dir), "state"), join(googleHome(dir), "data")]) {
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder)) if (/^oauth-manual-state-.*\.json$/.test(name)) rmSync(join(folder, name), { force: true });
  }
}
async function invoke(dir, args, options = {}, run = runProcess) {
  if (!existsSync(googleBin(dir))) throw new HttpError("google_not_installed", 409, "Install Google Workspace first");
  try {
    const text = await run(googleBin(dir), ["--client", "lares", "--json", "--no-input", ...args], { ...options, env: googleEnvironment(dir) });
    return JSON.parse(text);
  } catch {
    throw new HttpError("google_command_failed", 502, "Google Workspace could not complete this operation. Check API access, permissions, or reconnect your account.");
  }
}
export function googleStatus(dir) {
  const saved = readJsonFile(stateFile(dir)) ?? {};
  const pending = readJsonFile(pendingFile(dir));
  const configured = saved.configured === true;
  const email = typeof saved.email === "string" ? saved.email : "";
  return { configured, connected: Boolean(email) && saved.connected === true, email, services: GOOGLE_SERVICES,
    status: pending?.expiresAt > Date.now() ? "authorizing" : saved.status ?? (configured ? "disconnected" : "unconfigured") };
}
export async function importGoogleClient(dir, raw, run = runProcess) {
  return withGoogleLock(dir, async () => {
    const credentials = validateGoogleClient(raw);
    if (googleStatus(dir).email) throw new HttpError("google_connected", 409, "Disconnect the Google account before replacing its OAuth configuration");
    await invoke(dir, ["auth", "credentials", "set", "-"], { stdin: JSON.stringify(credentials) }, run);
    clearPending(dir);
    writeJsonFile(stateFile(dir), { configured: true, connected: false, email: "", status: "disconnected" });
    return googleStatus(dir);
  });
}
export async function startGoogleAuth(dir, input, run = runProcess) {
  return withGoogleLock(dir, async () => {
    const current = googleStatus(dir);
    if (!current.configured) throw new HttpError("google_unconfigured", 409, "Import a Google OAuth client JSON first");
    const email = googleEmail(input);
    if (current.email && current.email !== email) throw new HttpError("google_connected", 409, "Disconnect the current Google account before switching accounts");
    clearPending(dir);
    const result = await invoke(dir, ["auth", "add", email, "--services", GOOGLE_SERVICES.join(","), "--remote", "--step", "1", "--force-consent"], {}, run);
    let url;
    try { url = new URL(result.auth_url); } catch { /* Validated below. */ }
    const state = url?.searchParams.get("state");
    if (url?.origin !== "https://accounts.google.com" || !state) throw new HttpError("google_auth_failed", 502, "Could not start Google authorization");
    const expiresAt = Date.now() + 5 * 60_000;
    writeJsonFile(pendingFile(dir), { email, state, redirectUri: url.searchParams.get("redirect_uri"), expiresAt });
    return { url: url.toString(), expiresAt };
  });
}
export function validateGoogleCallback(raw, pending, now = Date.now()) {
  if (!pending || pending.expiresAt <= now) throw new HttpError("google_auth_expired", 409, "Authorization expired. Start Google authorization again.");
  let url;
  try { if (typeof raw === "string" && raw.length <= 16_384) url = new URL(raw.trim()); } catch { /* Validated below. */ }
  const expected = new URL(pending.redirectUri);
  if (!url || url.origin !== expected.origin || url.pathname !== expected.pathname || url.username || url.password || url.hash) {
    throw new HttpError("invalid_google_callback", 400, "Paste the complete return address from Google authorization");
  }
  const actual = Buffer.from(url.searchParams.get("state") ?? "");
  const state = Buffer.from(pending.state);
  if (actual.length !== state.length || !timingSafeEqual(actual, state)) throw new HttpError("invalid_google_state", 400, "Authorization does not match this connection attempt");
  if (url.searchParams.has("error")) throw new HttpError("google_auth_cancelled", 400, "Google authorization was cancelled. Start again when ready.");
  if (!url.searchParams.get("code")) throw new HttpError("invalid_google_callback", 400, "The return address does not contain an authorization code");
  return url.toString();
}
export async function completeGoogleAuth(dir, raw, run = runProcess) {
  return withGoogleLock(dir, async () => {
    const pending = readJsonFile(pendingFile(dir));
    const callback = validateGoogleCallback(raw, pending);
    // Consume even on exchange failure; codes cannot safely be retried after use.
    rmSync(pendingFile(dir), { force: true });
    try {
      const result = await invoke(dir, ["auth", "add", pending.email, "--services", GOOGLE_SERVICES.join(","), "--remote", "--step", "2", "--force-consent", "--auth-url", callback], {}, run);
      if (result.stored !== true || result.email?.toLowerCase() !== pending.email) throw new HttpError("google_account_mismatch", 502, "Google account did not match the requested email");
      writeJsonFile(stateFile(dir), { configured: true, connected: true, email: pending.email, status: "connected" });
      return googleStatus(dir);
    } finally { clearPending(dir); }
  });
}
export async function disconnectGoogle(dir, run = runProcess) {
  return withGoogleLock(dir, async () => {
    const current = googleStatus(dir);
    if (current.email) await invoke(dir, ["auth", "remove", current.email, "--force"], {}, run);
    clearPending(dir);
    writeJsonFile(stateFile(dir), { configured: current.configured, connected: false, email: "", status: "disconnected" });
    return googleStatus(dir);
  });
}
export async function checkGoogleConnection(dir, run = runProcess) {
  return withGoogleLock(dir, async () => {
    const current = googleStatus(dir);
    if (!current.email) return current;
    try {
      const result = await invoke(dir, ["auth", "list", "--check", "--timeout", "15s"], {}, run);
      const accounts = Array.isArray(result) ? result : result.accounts ?? [];
      const account = accounts.find((entry) => entry.email?.toLowerCase() === current.email && entry.client === "lares");
      if (!account || account.valid !== true) throw new Error("connection needs authorization");
      writeJsonFile(stateFile(dir), { configured: true, connected: true, email: current.email, status: "connected" });
    } catch {
      writeJsonFile(stateFile(dir), { configured: true, connected: false, email: current.email, status: "reauthorize" });
      throw new HttpError("google_reauthorize", 502, "Could not verify Google access. Check network access and reconnect if authorization has expired or been revoked.");
    }
    return googleStatus(dir);
  });
}
