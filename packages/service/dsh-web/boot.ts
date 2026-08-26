import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../config/env.js";
import { bootstrapLaresSettings, ROUTER_CREDENTIAL_REF } from "../olares/bootstrap-settings.js";
import {
  fetchRouterModels,
  pickChatModelId,
  type RouterModelEntry,
} from "../olares/router-models.js";
import { seedOlaresSkills } from "../olares/skills-seed.js";
import { seedWorkspaceAgents } from "../dsh/agents-seed.js";
import { identityPrompt } from "@lares/core/brand/identity";
import {
  ensureLaresWebProfile,
  installProfileDeps,
  patchConnectionTrustFences,
  patchSettingsNavIcon,
  resolveDshBin,
} from "./profile.js";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Non-empty bearer for routes the /llm/v1 shim authenticates on our behalf. */
const SHIM_BEARER = "olares-router-shim";

/** Boot official dsh web composition with Lares overlay (replaces Express SPA host). */
export async function bootLaresWeb(): Promise<void> {
  const env = loadEnv();
  mkdirSync(env.dataDir, { recursive: true });
  mkdirSync(env.workspace, { recursive: true });
  seedWorkspaceAgents(env.workspace);
  const skillsDir = seedOlaresSkills(path.join(env.dataDir, "skills"));
  const sessionRoot = path.join(env.dataDir, "dsh-sessions");
  mkdirSync(sessionRoot, { recursive: true });

  const { dshHome, profileDir } = ensureLaresWebProfile(env.dataDir);

  await installProfileDeps(profileDir);
  patchConnectionTrustFences();
  patchSettingsNavIcon();

  let catalogModels: RouterModelEntry[] = [];
  try {
    catalogModels = await fetchRouterModels(env);
    console.log(`[lares] Router catalog: ${catalogModels.length} model(s)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[lares] Router model sync skipped: ${message}`);
  }
  const chatFallback = pickChatModelId(catalogModels);
  const llmBase = `http://127.0.0.1:${env.port}/llm/v1`;
  const bootstrapped = bootstrapLaresSettings(dshHome, {
    catalog: catalogModels,
    baseURL: llmBase,
    chatFallback,
  });
  if (bootstrapped.changed) {
    const route = bootstrapped.routeSeeded ? "seeded" : "updated";
    console.log(`[lares] ${route} llm-pi-ai provider olares-router (${bootstrapped.routeModels} model(s))`);
    console.log(`[lares] agent-default-model → ${bootstrapped.model}`);
  }
  const resolvedModel =
    bootstrapped.model
    ?? chatFallback
    ?? process.env.DSH_MODEL?.trim()
    ?? null;
  // dsh CLI rejects --host 0.0.0.0; actual bind is forced to 0.0.0.0 in
  // @lares/dsh-overlay webserver patch for K8s probes / mesh.
  const cliHost = "127.0.0.1";
  const bindHost = "0.0.0.0";
  const dshBin = resolveDshBin();
  const trustedHosts = [
    ...(process.env.DSH_TRUSTED_HOSTS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ];

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_HOME: dshHome,
    PORT: String(env.port),
    HOSTNAME: bindHost,
    DSH_HOST: bindHost,
    DSH_PORT: String(env.port),
    DSH_CWD: env.workspace,
    LARES_WORKSPACE: env.workspace,
    LARES_DATA_DIR: env.dataDir,
    LARES_CLI_ROOT: env.cliRoot,
    // The bundled-root hook of dsh-skill-filesystem, which the `standard` agent
    // preset mounts with default roots. Nothing else reaches these skills: the
    // provider's own roots are the project's, `$DSH_HOME/skills`, and
    // `$DSH_AGENTS_HOME/skills`, none of which is where we seed them.
    DSH_BUNDLED_SKILL_DIR: skillsDir,
    DSH_SESSION_ROOT: sessionRoot,
    LARES_LLM_BASE_URL: llmBase,
    LLM_GATEWAY_URL: env.routerUrl,
    OLARES_APP_ID: env.olaresAppId,
    LARES_ROUTER_API_KEY: env.routerApiKey ?? "",
    // The shim strips Authorization and attaches Router auth, so this only has
    // to satisfy pi-ai's non-empty credential gate on the Router route.
    [ROUTER_CREDENTIAL_REF]: SHIM_BEARER,
    DSH_MODEL: resolvedModel ?? "default",
    DSH_PERMISSION_MODE: process.env.DSH_PERMISSION_MODE ?? process.env.LARES_PERMISSION_MODE ?? "workspace-write",
    LARES_PERMISSION_MODE: process.env.LARES_PERMISSION_MODE ?? process.env.DSH_PERMISSION_MODE ?? "workspace-write",
    DSH_SYSTEM_PROMPT: process.env.DSH_SYSTEM_PROMPT?.trim() || identityPrompt(),
  };

  console.log(`[lares] starting dsh web profile=lares-web bind=http://${bindHost}:${env.port} (cli --host ${cliHost})`);
  console.log(`[lares] DSH_HOME=${dshHome} workspace=${env.workspace} model=${resolvedModel ?? "(unset)"}`);
  const dshArgs = [dshBin, "--profile", "lares-web", "--host", cliHost, "--port", String(env.port)];
  for (const authority of trustedHosts) {
    dshArgs.push("--trusted-host", authority);
  }

  const child = spawn(process.execPath, dshArgs, {
    cwd: APP_ROOT,
    env: childEnv,
    stdio: "inherit",
  });

  const shutdown = () => {
    child.kill("SIGTERM");
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        resolve();
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`dsh exited with code ${code}`));
    });
  });
}