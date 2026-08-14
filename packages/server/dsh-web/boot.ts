import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../config/env.js";
import { bootstrapAgentDefaultModel } from "../olares/bootstrap-settings.js";
import {
  fetchRouterModels,
  isChatModelId,
  isPlaceholderModelId,
  pickChatModelId,
} from "../olares/router-models.js";
import { seedOlaresSkills } from "../olares/skills-seed.js";
import { seedWorkspaceAgents } from "../dsh/agents-seed.js";
import { ensureDinaWebProfile, resolveDshBin } from "./profile.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Boot official dsh web composition with Dina overlay (replaces Express SPA host). */
export async function bootDinaWeb(): Promise<void> {
  const env = loadEnv();
  mkdirSync(env.dataDir, { recursive: true });
  mkdirSync(env.workspace, { recursive: true });
  seedWorkspaceAgents(env.workspace);
  const skillsDir = seedOlaresSkills(path.join(env.dataDir, "skills"));
  const sessionRoot = path.join(env.dataDir, "dsh-sessions");
  mkdirSync(sessionRoot, { recursive: true });

  const { dshHome, profileDir } = ensureDinaWebProfile(env.dataDir);

  // Install profile-local file: deps once (idempotent enough for hot reload).
  await installProfileDeps(profileDir);

  let catalogModels: { id: string; name: string }[] = [];
  try {
    catalogModels = await fetchRouterModels(env);
    console.log(`[dina] Router catalog: ${catalogModels.length} model(s)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[dina] Router model sync skipped: ${message}`);
  }
  const chatFallback = pickChatModelId(catalogModels);
  const bootstrapped = bootstrapAgentDefaultModel(dshHome, catalogModels, env.defaultModel, chatFallback);
  if (bootstrapped.changed) {
    console.log(`[dina] agent-default-model → ${bootstrapped.model}`);
  }
  const resolvedModel =
    (env.defaultModel && !isPlaceholderModelId(env.defaultModel) ? env.defaultModel : null)
    ?? bootstrapped.model
    ?? chatFallback
    ?? process.env.DSH_MODEL?.trim()
    ?? null;

  // dsh CLI rejects --host 0.0.0.0; actual bind is forced to 0.0.0.0 in
  // @dina/bundle-web webserver patch for K8s probes / mesh.
  const cliHost = "127.0.0.1";
  const bindHost = "0.0.0.0";
  const llmBase = `http://127.0.0.1:${env.port}/llm/v1`;
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
    DINA_WORKSPACE: env.workspace,
    DINA_DATA_DIR: env.dataDir,
    DINA_CLI_ROOT: env.cliRoot,
    DINA_SKILLS_DIR: skillsDir,
    DSH_SESSION_ROOT: sessionRoot,
    DEEPSEEK_BASE_URL: llmBase,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY?.trim() || "dina-local",
    LLM_GATEWAY_URL: env.routerUrl,
    OLARES_APP_ID: env.olaresAppId,
    DINA_ROUTER_API_KEY: env.routerApiKey ?? "",
    DINA_DEFAULT_MODEL: resolvedModel ?? "",
    DSH_MODEL: resolvedModel ?? "default",
    DINA_ROUTER_MODELS_JSON: JSON.stringify(
      (() => {
        const chat = catalogModels.filter((m) => isChatModelId(m.id));
        const list = chat.length > 0 ? chat : catalogModels;
        return list.length > 0
          ? list.map((m) => ({ id: m.id, name: m.name, contextWindow: 128000 }))
          : [{ id: resolvedModel ?? "default", name: "Default", contextWindow: 128000 }];
      })(),
    ),
    DSH_PERMISSION_MODE: process.env.DSH_PERMISSION_MODE ?? process.env.DINA_PERMISSION_MODE ?? "workspace-write",
    DINA_PERMISSION_MODE: process.env.DINA_PERMISSION_MODE ?? process.env.DSH_PERMISSION_MODE ?? "workspace-write",
    DSH_SYSTEM_PROMPT:
      process.env.DSH_SYSTEM_PROMPT?.trim() ||
      [
        "You are Dina, a helpful assistant running on Olares.",
        "Prefer olares-cli for Olares platform tasks when skills apply.",
        "olares-cli is on PATH; edge login materializes HOME / OLARES_CLI_* for bash when the user opens Dina via the Olares entrance.",
        "Use read/write/edit for files; use background jobs for long shell work.",
      ].join(" "),
  };

  console.log(`[dina] starting dsh web profile=dina-web bind=http://${bindHost}:${env.port} (cli --host ${cliHost})`);
  console.log(`[dina] DSH_HOME=${dshHome} workspace=${env.workspace} model=${resolvedModel ?? "(unset)"}`);
  const dshArgs = [dshBin, "--profile", "dina-web", "--host", cliHost, "--port", String(env.port)];
  for (const authority of trustedHosts) {
    dshArgs.push("--trusted-host", authority);
  }

  const child = spawn(process.execPath, dshArgs, {
    cwd: PACKAGE_ROOT,
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

function installProfileDeps(profileDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Scripts enabled: native community plugins (node-pty) compile here as
    // uid 1000. Idempotent — npm skips scripts when node_modules already
    // satisfies the lockfile, so only first install pays the build cost.
    const child = spawn("npm", ["install", "--no-audit", "--no-fund"], {
      cwd: profileDir,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm install in profile failed: ${code}`));
    });
  });
}
