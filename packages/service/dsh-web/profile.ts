/**
 * Ensure $DSH_HOME/profiles/dina-web exists with Dina bundles.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
/** Repo root / container `/app` (sibling of `packages/` or `dist/`). */
const APP_ROOT = join(HERE, "../../..");
const BUNDLE_WEB = join(APP_ROOT, "packages", "plugins", "bundle-web");
const CLIENT_DINA = join(APP_ROOT, "packages", "plugins", "client-dina");
const VOICE_INPUT = join(APP_ROOT, "packages", "plugins", "voice-input");
const WEB_SEARCH = join(APP_ROOT, "packages", "plugins", "web-search");

const SHELL_BUNDLES = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] as const;

/**
 * Dina's overlay is the LAST bundle layer, after any community bundle installed
 * into this profile. dsh composes a profile as patch layers concatenated in
 * `dsh.profile.bundles` order, and a patch may only target a row an earlier
 * layer already inserted — a row addressed before its insert warns and is
 * skipped. A community bundle mounts itself by inserting its own row, so
 * `cordis.patch.yml` can configure or disable one only from behind it.
 */
const DINA_BUNDLE = "@dina/bundle-web";

const OWNED_BUNDLES: readonly string[] = [...SHELL_BUNDLES, DINA_BUNDLE];

function resolveDshHome(dataDir: string): string {
  return process.env.DSH_HOME?.trim() || join(dataDir, "dsh-home");
}

/**
 * @param dataDir - Dina data directory (sessions, skills, dsh-home)
 * @returns dsh home and dina-web profile directory
 */
export function ensureDinaWebProfile(dataDir: string): { dshHome: string; profileDir: string } {
  const dshHome = resolveDshHome(dataDir);
  const profileDir = join(dshHome, "profiles", "dina-web");
  mkdirSync(profileDir, { recursive: true });

  const manifestPath = join(profileDir, "package.json");
  let previous: {
    dependencies?: Record<string, string>;
    dsh?: { profile?: { bundles?: string[] } };
    pnpm?: Record<string, unknown>;
  } = {};
  if (existsSync(manifestPath)) {
    try {
      previous = JSON.parse(readFileSync(manifestPath, "utf8")) as typeof previous;
    } catch {
      previous = {};
    }
  }

  const extraBundles = (previous.dsh?.profile?.bundles ?? []).filter((name) => !OWNED_BUNDLES.includes(name));
  const bundles = [...SHELL_BUNDLES, ...extraBundles, DINA_BUNDLE];

  const manifest = {
    name: "dina-web-profile",
    private: true,
    type: "module",
    dependencies: {
      ...(previous.dependencies ?? {}),
      "@dina/bundle-web": `file:${BUNDLE_WEB}`,
      "@dina/client-dina": `file:${CLIENT_DINA}`,
      "@dina/voice-input": `file:${VOICE_INPUT}`,
      "@dina/web-search": `file:${WEB_SEARCH}`,
    },
    ...(previous.pnpm ? { pnpm: previous.pnpm } : {}),
    dsh: {
      profile: {
        bundles,
      },
    },
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const patchPath = join(profileDir, "cordis.patch.yml");
  if (!existsSync(patchPath)) {
    writeFileSync(
      patchPath,
      `# dina-web user layer (hot-reloaded). Keep as a YAML list.
# Add user overrides here.
[]
`,
    );
  }

  return { dshHome, profileDir };
}

/**
 * Install the profile's declared bundles.
 *
 * `--legacy-peer-deps` is load-bearing, not a conflict workaround: community
 * bundles peer-depend on the dsh runtime, which lives in the image install and
 * reaches the profile through the symlink fallback at
 * $DSH_HOME/profiles/node_modules. npm cannot see that fallback, reads every
 * dsh peer as unmet, and installs a second copy into the profile's own
 * node_modules, where it shadows the fallback. Two live copies of dsh-scope
 * mean two module-local scope symbols, so an agent tagged by one copy reads as
 * unscoped to the other — sessions then fail with "refusing to compose an
 * unscoped context".
 *
 * Scripts stay enabled: native bundles (node-pty) compile here as uid 1000.
 * @param profileDir - the dina-web profile directory.
 */
export function installProfileDeps(profileDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["install", "--no-audit", "--no-fund", "--legacy-peer-deps"], {
      cwd: profileDir,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`npm install in profile failed: ${code}`));
        return;
      }
      patchSidebarTrustFence(profileDir);
      resolve();
    });
  });
}

const CLIENT_LOOPBACK_ANCHOR = "isLoopback: pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname),";

const CLIENT_LOOPBACK_REPLACEMENT = "isLoopback: true,";

const HOST_INTERCEPTOR_ANCHOR =
  'if (interceptor.options.authority === "loopback" && !isTrustedApiRequest(request, []))';

const HOST_INTERCEPTOR_REPLACEMENT =
  'if (interceptor.options.authority === "loopback" && !isTrustedApiRequest(request, this.trustedHosts))';

const HOST_PRIVILEGED_ANCHOR =
  "if (method !== void 0 && PRIVILEGED_METHODS.has(method) && !isTrustedApiRequest(request, []))";

const HOST_PRIVILEGED_REPLACEMENT =
  "if (method !== void 0 && PRIVILEGED_METHODS.has(method) && !isTrustedApiRequest(request, trustedHosts))";

function replaceRequired(source: string, anchor: string, replacement: string): string {
  if (source.includes(replacement)) return source;
  if (!source.includes(anchor)) {
    throw new Error(`dsh-client-connection trust patch anchor not found: ${anchor}`);
  }
  return source.replace(anchor, replacement);
}

export function trustOlaresConnectionHost(source: string): string {
  return replaceRequired(
    replaceRequired(source, HOST_INTERCEPTOR_ANCHOR, HOST_INTERCEPTOR_REPLACEMENT),
    HOST_PRIVILEGED_ANCHOR,
    HOST_PRIVILEGED_REPLACEMENT,
  );
}

/**
 * dsh pins the browser's whole configuration plane to loopback-same-origin
 * "until a real authentication layer exists": off loopback every settings scope
 * binds in `memory` mode, never issues settings.describe, and renders empty —
 * the Models page, the plugin cards, the configuration-file action, the
 * agent-preset chip, and theme/locale persistence all disappear behind the
 * Olares entrance. That entrance IS the authentication layer (authLevel
 * private, Authelia-terminated, one pod per user), the same judgement the host
 * makes in dina-olares-identity for the privileged /api fence.
 *
 * The flag lives on the connection handle that `@deepseek-ai/dsh-client-connection`
 * builds in its own apply, and each consumer reads it once, at its own
 * `settingsScope.bind()`. A client plugin flipping it afterwards is a race it
 * loses whenever a consumer's bundle is already cached, so the deployment
 * stance belongs in the served bundle instead.
 *
 * The Host has the same restriction twice: strict interceptors (including the
 * API remotes used by model selection) and privileged settings methods both
 * pass an empty trust list. Olares' private entrance is the authentication
 * boundary, so the declared DSH_TRUSTED_HOSTS authorities must reach those
 * channels while the normal Host/Origin/cross-site checks remain intact.
 *
 * Remove once dsh can be configured with an authenticated remote origin.
 */
export function patchConnectionTrustFences(): void {
  const clientLib = require.resolve("@deepseek-ai/dsh-client-connection/client");
  const clientSource = readFileSync(clientLib, "utf8");
  if (!clientSource.includes(CLIENT_LOOPBACK_REPLACEMENT)) {
    if (!clientSource.includes(CLIENT_LOOPBACK_ANCHOR)) {
      throw new Error("dsh-client-connection client trust patch anchor not found");
    }
    writeFileSync(clientLib, clientSource.replace(CLIENT_LOOPBACK_ANCHOR, CLIENT_LOOPBACK_REPLACEMENT));
  }

  const hostLib = require.resolve("@deepseek-ai/dsh-client-connection");
  const hostSource = readFileSync(hostLib, "utf8");
  const trustedHostSource = trustOlaresConnectionHost(hostSource);
  if (trustedHostSource !== hostSource) writeFileSync(hostLib, trustedHostSource);

  console.log("[dina] dsh-client-connection trust fences → Olares trusted hosts");
}

const SIDEBAR_FENCE_ANCHOR =
  'for (const entry of ctx.loader.entries()) if (entry.options.name === "connection") return entry.options.config?.trustedHosts ?? [];';

const SIDEBAR_FENCE_REPLACEMENT =
  'return (process.env.DSH_TRUSTED_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);';

/**
 * dsh-better-sidebar's browser-trust fence resolves its trusted authorities to
 * an empty list on any dsh-web-app profile, so every /sidebar request whose Host
 * is not loopback — i.e. every request through the Olares entrance — answers 403
 * (the terminal/editor chunk scripts fail to load first and loudest). Two
 * reasons, both in its `trustedHostsOf`: the loader stores the module specifier
 * in `options.name` ('connection' is the row *id*), and `!!js` config stays a
 * `{__jsExpr}` node until the loader interpolates it at apply time.
 *
 * DSH_TRUSTED_HOSTS is the same authority list boot passes as `--trusted-host`,
 * which is what the /api gateway's fence ends up trusting. LAN-IP literals dsh
 * derives per bind are intentionally absent: on Olares the browser reaches the
 * app through the entrance domain, and loopback still passes.
 *
 * Remove once upstream reads the resolved list.
 * @param profileDir - the dina-web profile directory.
 */
function patchSidebarTrustFence(profileDir: string): void {
  const lib = join(profileDir, "node_modules", "dsh-better-sidebar", "lib", "index.js");
  if (!existsSync(lib)) return;
  const source = readFileSync(lib, "utf8");
  if (source.includes(SIDEBAR_FENCE_REPLACEMENT)) return;
  if (!source.includes(SIDEBAR_FENCE_ANCHOR)) {
    console.warn(
      "[dina] dsh-better-sidebar trust-fence patch skipped: anchor not found." +
        " If /sidebar routes answer 403, re-check the upstream fence.",
    );
    return;
  }
  writeFileSync(lib, source.replace(SIDEBAR_FENCE_ANCHOR, SIDEBAR_FENCE_REPLACEMENT));
  console.log("[dina] dsh-better-sidebar trust fence → DSH_TRUSTED_HOSTS");
}

/** Absolute path to the published dsh CLI entry. */
export function resolveDshBin(): string {
  const pkgJson = require.resolve("@deepseek-ai/dsh/package.json");
  const pkg = JSON.parse(readFileSync(pkgJson, "utf8")) as { bin?: string | Record<string, string> };
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.dsh;
  if (!bin) throw new Error("@deepseek-ai/dsh has no bin");
  return join(dirname(pkgJson), bin);
}
