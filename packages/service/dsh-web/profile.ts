/**
 * Ensure $DSH_HOME/profiles/lares-web exists with Lares bundles.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
/** Repo root / container `/app` (sibling of `packages/` or `dist/`). */
const APP_ROOT = join(HERE, "../../..");
const BUNDLE_WEB = join(APP_ROOT, "packages", "plugins", "bundle-web");
const CLIENT_LARES = join(APP_ROOT, "packages", "plugins", "client-lares");
const VOICE_INPUT = join(APP_ROOT, "packages", "plugins", "voice-input");
const WEB_SEARCH = join(APP_ROOT, "packages", "plugins", "web-search");
const MODELS = join(APP_ROOT, "packages", "plugins", "models");
const LOCAL_PROFILE_PACKAGES = [
  ["@lares/bundle-web", BUNDLE_WEB],
  ["@lares/client-lares", CLIENT_LARES],
  ["@lares/voice-input", VOICE_INPUT],
  ["@lares/web-search", WEB_SEARCH],
  ["@lares/models", MODELS],
] as const;

const SHELL_BUNDLES = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] as const;

/**
 * Lares's overlay is the LAST bundle layer, after any community bundle installed
 * into this profile. dsh composes a profile as patch layers concatenated in
 * `dsh.profile.bundles` order, and a patch may only target a row an earlier
 * layer already inserted — a row addressed before its insert warns and is
 * skipped. A community bundle mounts itself by inserting its own row, so
 * `cordis.patch.yml` can configure or disable one only from behind it.
 */
const LARES_BUNDLE = "@lares/bundle-web";

const OWNED_BUNDLES: readonly string[] = [...SHELL_BUNDLES, LARES_BUNDLE];

function resolveDshHome(dataDir: string): string {
  return process.env.DSH_HOME?.trim() || join(dataDir, "dsh-home");
}

/**
 * @param dataDir - Lares data directory (sessions, skills, dsh-home)
 * @returns dsh home and lares-web profile directory
 */
export function ensureLaresWebProfile(dataDir: string): { dshHome: string; profileDir: string } {
  const dshHome = resolveDshHome(dataDir);
  const profileDir = join(dshHome, "profiles", "lares-web");
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
  const bundles = [...SHELL_BUNDLES, ...extraBundles, LARES_BUNDLE];

  const manifest = {
    name: "lares-web-profile",
    private: true,
    type: "module",
    dependencies: {
      ...(previous.dependencies ?? {}),
      "@lares/bundle-web": `file:${BUNDLE_WEB}`,
      "@lares/client-lares": `file:${CLIENT_LARES}`,
      "@lares/voice-input": `file:${VOICE_INPUT}`,
      "@lares/web-search": `file:${WEB_SEARCH}`,
      "@lares/models": `file:${MODELS}`,
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
      `# lares-web user layer (hot-reloaded). Keep as a YAML list.
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
 * @param profileDir - the lares-web profile directory.
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
      try {
        linkOwnedProfileDeps(profileDir);
        patchSidebarTrustFence(profileDir);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * npm reuses copied `file:` packages when their version is unchanged, leaving
 * profile patches stale after a dev sync. Keep Lares-owned packages linked to
 * their authoritative source; community dependencies remain npm-managed.
 */
export function linkOwnedProfileDeps(
  profileDir: string,
  packages: ReadonlyArray<readonly [name: string, source: string]> = LOCAL_PROFILE_PACKAGES,
): void {
  for (const [name, source] of packages) {
    const target = join(profileDir, "node_modules", ...name.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    rmSync(target, { recursive: true, force: true });
    symlinkSync(source, target, "dir");
  }
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
 * makes in lares-olares-identity for the privileged /api fence.
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

  console.log("[lares] dsh-client-connection trust fences → Olares trusted hosts");
}

const NAV_ICON_ROW_ANCHOR = 'resolveSlotLabel)(e.options.label) ?? ""';

const NAV_ICON_ROW_REPLACEMENT = `${NAV_ICON_ROW_ANCHOR}, icon: e.component?.navIcon`;

const NAV_ICON_FN_ANCHOR = "function navIcon(id) {";

const NAV_ICON_FN_REPLACEMENT =
  "function navIcon(id, custom) {\n" +
  "\t\t\tif (custom !== void 0) return (0, react_jsx_runtime.jsx)(custom, " +
  "{ className: SettingsRoot_module_css_default.navIcon, size: 16 });";

const NAV_ICON_CALL_ANCHOR = "children: [navIcon(row.id),";

const NAV_ICON_CALL_REPLACEMENT = "children: [navIcon(row.id, row.icon),";

export function sectionComponentNavIcon(source: string): string {
  if (source.includes(NAV_ICON_FN_REPLACEMENT)) return source;
  return replaceRequired(
    replaceRequired(
      replaceRequired(source, NAV_ICON_ROW_ANCHOR, NAV_ICON_ROW_REPLACEMENT),
      NAV_ICON_FN_ANCHOR,
      NAV_ICON_FN_REPLACEMENT,
    ),
    NAV_ICON_CALL_ANCHOR,
    NAV_ICON_CALL_REPLACEMENT,
  );
}

/**
 * The settings shell picks each nav glyph from a closed `navIcon(id)` switch
 * over the ids it ships (models, agent-presets, plugins); every other section
 * — i.e. every Lares one — falls back to the same settings gear, so the nav
 * column reads as identical rows. Slot options are no channel for a glyph:
 * SlotCore.register keeps a fixed field set (key/id/order/label/priority) and
 * drops anything else before the shell ever sees it.
 *
 * The registered component does survive, so a section carries its glyph as a
 * `navIcon` static and the nav-row projection reads it there. Each glyph stays
 * owned by the feature that owns the section (web-search's globe,
 * voice-input's mic) rather than being centralised in a patch, and sections
 * without the static keep upstream's switch.
 *
 * Remove once the settings.section contract accepts an icon.
 */
export function patchSettingsNavIcon(): void {
  const webAppDir = dirname(require.resolve("@deepseek-ai/dsh-web-app/package.json"));
  const lib = require.resolve("@deepseek-ai/dsh-client-ui-settings-general/client", { paths: [webAppDir] });
  const source = readFileSync(lib, "utf8");
  const patched = sectionComponentNavIcon(source);
  if (patched === source) return;

  writeFileSync(lib, patched);
  console.log("[lares] settings nav icons → section component navIcon");
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
 * @param profileDir - the lares-web profile directory.
 */
function patchSidebarTrustFence(profileDir: string): void {
  const lib = join(profileDir, "node_modules", "dsh-better-sidebar", "lib", "index.js");
  if (!existsSync(lib)) return;
  const source = readFileSync(lib, "utf8");
  if (source.includes(SIDEBAR_FENCE_REPLACEMENT)) return;
  if (!source.includes(SIDEBAR_FENCE_ANCHOR)) {
    console.warn(
      "[lares] dsh-better-sidebar trust-fence patch skipped: anchor not found." +
        " If /sidebar routes answer 403, re-check the upstream fence.",
    );
    return;
  }
  writeFileSync(lib, source.replace(SIDEBAR_FENCE_ANCHOR, SIDEBAR_FENCE_REPLACEMENT));
  console.log("[lares] dsh-better-sidebar trust fence → DSH_TRUSTED_HOSTS");
}

/** Absolute path to the published dsh CLI entry. */
export function resolveDshBin(): string {
  const pkgJson = require.resolve("@deepseek-ai/dsh/package.json");
  const pkg = JSON.parse(readFileSync(pkgJson, "utf8")) as { bin?: string | Record<string, string> };
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.dsh;
  if (!bin) throw new Error("@deepseek-ai/dsh has no bin");
  return join(dirname(pkgJson), bin);
}
