import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HttpError } from "../tools/http.js";
import { GOOGLE_SKILLS } from "./packs.js";
import { packCacheDir } from "./state.js";
import { runProcess } from "./process.js";

export const GOG_VERSION = "0.46.0";
export const GOOGLE_PACK = "google-workspace";
const installs = new Map();
export const googleCache = (dir) => packCacheDir(dir, GOOGLE_PACK);
export const googleBin = (dir) => join(googleCache(dir), "bin", "gog");
export const googleHome = (dir) => join(resolve(dir), "integrations", GOOGLE_PACK);
export const googleLauncher = (dir) => join(resolve(dir), "plugin-bin", "gog");

export function gogAsset(platform = process.platform, arch = process.arch) {
  const os = { linux: "linux", darwin: "darwin" }[platform];
  const cpu = { x64: "amd64", arm64: "arm64" }[arch];
  if (!os || !cpu) throw new HttpError("unsupported_platform", 400, "Google Workspace supports Linux/macOS amd64 and arm64");
  return `gogcli_${GOG_VERSION}_${os}_${cpu}.tar.gz`;
}
export function verifyGogChecksum(bytes, checksums, name) {
  const row = String(checksums).split(/\r?\n/).find((line) => line.trim().split(/\s+/).at(-1)?.replace(/^\*/, "") === name);
  const expected = row?.trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/i.test(expected ?? "") || createHash("sha256").update(bytes).digest("hex") !== expected.toLowerCase()) {
    throw new HttpError("checksum_failed", 502, "gogcli archive checksum did not match");
  }
}
export async function fetchArtifact(url, max = 64 * 1024 * 1024) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const chunks = []; let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > max) throw new Error("download too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function installGoogleLauncher(dir) {
  const home = googleHome(dir);
  await mkdir(home, { recursive: true, mode: 0o700 });
  const passwordFile = join(home, "keyring-password");
  if (!existsSync(passwordFile)) await writeFile(passwordFile, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
  const launcher = join(home, "launcher.cjs");
  const source = `const fs = require('node:fs');
const {spawn} = require('node:child_process');
const home = ${JSON.stringify(home)};
let password;
try { password = fs.readFileSync(home + '/keyring-password', 'utf8').trim(); }
catch { console.error('Configure Google Workspace in Lares Plugins first.'); process.exit(1); }
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GOG_')));
let saved = {};
try { saved = JSON.parse(fs.readFileSync(home + '/connection.json', 'utf8')); } catch {}
const child = spawn(${JSON.stringify(resolve(googleBin(dir)))}, process.argv.slice(2), {
  stdio: 'inherit', env: {...env, GOG_ACCOUNT: saved.email || '', GOG_HOME: home, GOG_CLIENT: 'lares', GOG_KEYRING_BACKEND: 'file', GOG_KEYRING_PASSWORD: password}
});
child.on('error', () => { console.error('Google Workspace CLI unavailable; reinstall the plugin.'); process.exitCode = 1; });
child.on('exit', (code, signal) => { if(signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1; });
`;
  await writeFile(launcher, source, { mode: 0o700 });
  const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
  await mkdir(dirname(googleLauncher(dir)), { recursive: true });
  await writeFile(googleLauncher(dir), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(launcher)} "$@"\n`, { mode: 0o755 });
  await chmod(googleLauncher(dir), 0o755);
}
export function installGoogle(dir, options = {}) {
  const key = resolve(dir);
  if (installs.has(key)) return installs.get(key);
  const promise = performInstall(key, options).finally(() => installs.delete(key));
  installs.set(key, promise);
  return promise;
}
async function performInstall(dir, { download = fetchArtifact, run = runProcess } = {}) {
  const target = googleCache(dir);
  await mkdir(dirname(target), { recursive: true });
  const stage = await mkdtemp(join(dirname(target), ".google-"));
  const previous = `${stage}-previous`;
  let moved = false;
  try {
    const asset = gogAsset();
    const base = `https://github.com/openclaw/gogcli/releases/download/v${GOG_VERSION}`;
    const bytes = await download(`${base}/${asset}`);
    const checksums = await download(`${base}/checksums.txt`, 1024 * 1024);
    verifyGogChecksum(bytes, checksums, asset);
    const archive = join(stage, "binary.tgz");
    await writeFile(archive, bytes);
    await mkdir(join(stage, "bin"));
    await run("tar", ["-xzf", archive, "-C", join(stage, "bin"), "gog"]);
    await chmod(join(stage, "bin", "gog"), 0o755);
    const version = await run(join(stage, "bin", "gog"), ["--version"]);
    if (!version.includes(GOG_VERSION)) throw new Error("unexpected gogcli version");
    const sourceArchive = join(stage, "skills.tgz");
    await writeFile(sourceArchive, await download(`https://codeload.github.com/openclaw/gogcli/tar.gz/refs/tags/v${GOG_VERSION}`));
    const paths = GOOGLE_SKILLS.map((name) => `gogcli-${GOG_VERSION}/.agents/skills/${name}`);
    await run("tar", ["-xzf", sourceArchive, "--strip-components=3", "-C", stage, ...paths]);
    for (const name of GOOGLE_SKILLS) {
      const body = await readFile(join(stage, name, "SKILL.md"), "utf8");
      if (!new RegExp(`^name: ["']?${name}["']?$`, "m").test(body)) throw new Error("invalid Google skill");
    }
    await rm(archive); await rm(sourceArchive);
    if (existsSync(target)) { await rename(target, previous); moved = true; }
    await rename(stage, target);
    try { await installGoogleLauncher(dir); }
    catch (err) { await rm(target, { recursive: true, force: true }); throw err; }
    await rm(previous, { recursive: true, force: true });
  } catch (err) {
    if (moved && existsSync(previous)) await rename(previous, target);
    if (err instanceof HttpError) throw err;
    throw new HttpError("google_install_failed", 502, "Google Workspace download or installation failed. Retry the installation.");
  } finally { await rm(stage, { recursive: true, force: true }); }
}
