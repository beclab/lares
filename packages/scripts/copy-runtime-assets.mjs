import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// Ship nested Dina dsh packages beside the server build for profile file: deps
// and Loader resolution from the image / hot-reload overlay.
for (const name of ["bundle-web", "client-dina"]) {
  const from = join(packageRoot, name);
  const to = join(packageRoot, "dist-server", name);
  if (!existsSync(from)) continue;
  rmSync(to, { recursive: true, force: true });
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

// Boot resolves PACKAGE_ROOT as packages/; keep overlays also at package root
// (already present). dist-server copies help when cwd is dist-server-only.
