/**
 * Offline dump of the dina-web composed config (requires npm deps installed).
 * Usage: npm run dump-config
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../config/env.js";
import { ensureDinaWebProfile, resolveDshBin } from "./profile.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const env = loadEnv();
const { dshHome, profileDir } = ensureDinaWebProfile(env.dataDir);

await new Promise((resolve, reject) => {
  const child = spawn("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: profileDir,
    stdio: "inherit",
  });
  child.on("error", reject);
  child.on("exit", (code) => (code === 0 ? resolve(undefined) : reject(new Error(String(code)))));
});

const dshBin = resolveDshBin();
const child = spawn(process.execPath, [dshBin, "--profile", "dina-web", "--dump-config"], {
  cwd: PACKAGE_ROOT,
  env: { ...process.env, DSH_HOME: dshHome, PORT: String(env.port), HOSTNAME: env.host },
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
