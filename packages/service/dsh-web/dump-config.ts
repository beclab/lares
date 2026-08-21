/**
 * Offline dump of the dina-web composed config (requires npm deps installed).
 * Usage: npm run dump-config
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../config/env.js";
import { ensureDinaWebProfile, installProfileDeps, resolveDshBin } from "./profile.js";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const env = loadEnv();
const { dshHome, profileDir } = ensureDinaWebProfile(env.dataDir);

await installProfileDeps(profileDir);

const dshBin = resolveDshBin();
const child = spawn(process.execPath, [dshBin, "--profile", "dina-web", "--dump-config"], {
  cwd: APP_ROOT,
  env: { ...process.env, DSH_HOME: dshHome, PORT: String(env.port), HOSTNAME: env.host },
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
