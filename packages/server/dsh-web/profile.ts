/**
 * Ensure $DSH_HOME/profiles/dina-web exists with Dina bundles.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, "../..");
const BUNDLE_WEB = join(PACKAGE_ROOT, "bundle-web");
const CLIENT_DINA = join(PACKAGE_ROOT, "client-dina");

const CORE_BUNDLES = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@dina/bundle-web"] as const;

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

  const extraBundles = (previous.dsh?.profile?.bundles ?? []).filter(
    (name) => !CORE_BUNDLES.includes(name as (typeof CORE_BUNDLES)[number]),
  );
  const bundles = [...CORE_BUNDLES, ...extraBundles];

  const manifest = {
    name: "dina-web-profile",
    private: true,
    type: "module",
    dependencies: {
      ...(previous.dependencies ?? {}),
      "@dina/bundle-web": `file:${BUNDLE_WEB}`,
      "@dina/client-dina": `file:${CLIENT_DINA}`,
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
# Client brand is inserted by @dina/bundle-web; add user overrides here.
[]
`,
    );
  } else {
    const existing = readFileSync(patchPath, "utf8");
    if (existing.includes("id: dina-client-brand") && existing.includes("@dina/client-dina")) {
      writeFileSync(
        patchPath,
        `# dina-web user layer (hot-reloaded). Keep as a YAML list.
# Client brand is inserted by @dina/bundle-web; add user overrides here.
[]
`,
      );
    }
  }

  return { dshHome, profileDir };
}

/** Absolute path to the published dsh CLI entry. */
export function resolveDshBin(): string {
  const pkgJson = require.resolve("@deepseek-ai/dsh/package.json");
  const pkg = JSON.parse(readFileSync(pkgJson, "utf8")) as { bin?: string | Record<string, string> };
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.dsh;
  if (!bin) throw new Error("@deepseek-ai/dsh has no bin");
  return join(dirname(pkgJson), bin);
}
