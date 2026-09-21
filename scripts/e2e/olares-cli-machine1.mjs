import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { E2ERunner, command, expectOk, parseJson } from "./lib/runner.mjs";

const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const prefix = `lares-e2e-${stamp}`;
const profile = process.env.LARES_E2E_PROFILE ?? "luolong01@olares.com";
const marketApp = process.env.LARES_E2E_MARKET_APP ?? "jsonhero";
const reportPath = process.env.LARES_E2E_REPORT ?? `/tmp/${prefix}-report.json`;
const remoteRoot = `drive/Home/${prefix}`;
const temp = await mkdtemp(join(tmpdir(), `${prefix}-`));
const runner = new E2ERunner({ reportPath, prefix });

async function cli(args, options = {}) {
  return command(["olares-cli", ...args], { ...options, timeoutMs: options.timeoutMs ?? 180_000 });
}

async function attempt(id, fn, options) {
  try {
    return await runner.check(id, fn, options);
  } catch {
    return undefined;
  }
}

function jsonItems(value) {
  if (Array.isArray(value)) return value;
  return value?.items ?? value?.data ?? [];
}

let originalProfile;
let marketInstalled = false;
let marketWasInstalled = false;

try {
  await attempt("profile.active", async () => {
    const before = expectOk(await cli(["profile", "list"]));
    const selected = before.stdout.split("\n").find((line) => line.trimStart().startsWith("*"));
    originalProfile = selected?.trim().split(/\s+/)[1];
    expectOk(await cli(["profile", "use", profile]));
    if (originalProfile && originalProfile !== profile) {
      runner.defer("profile.restore", async () => {
        expectOk(await cli(["profile", "use", originalProfile]));
        return originalProfile;
      });
    }
    return { profile };
  });

  for (const [id, args, optional = false] of [
    ["router.status", ["router", "status", "-o", "json"]],
    ["router.whoami", ["router", "whoami", "-o", "json"]],
    ["router.catalog.chat", ["router", "list", "--mode", "chat", "-o", "json"]],
    ["router.catalog.image", ["router", "list", "--mode", "image_generation", "-o", "json"]],
    ["router.default.show", ["router", "default", "show", "-o", "json"], true],
    ["dashboard.overview", ["dashboard", "overview", "-o", "json"]],
    ["dashboard.applications", ["dashboard", "applications", "-o", "json"]],
    ["cluster.context", ["cluster", "context", "-o", "json"]],
    ["cluster.pods", ["cluster", "pod", "list", "-o", "json"]],
    ["doctor.images", ["doctor", "images", "-o", "json"]],
    ["doctor.thirdleveldomain", ["doctor", "thirdleveldomain", "-o", "json"], true],
  ]) {
    await attempt(id, async () => {
      const value = parseJson(await cli(args));
      return { rows: jsonItems(value).length || undefined, ok: true };
    }, { optional });
  }

  await attempt("router.chat.call", async () => {
    const result = expectOk(await cli([
      "router", "call", "chat",
      "Reply with exactly: lares-e2e-ok",
      "--model", "default-chat", "--no-stream", "--quiet",
    ], { timeoutMs: 300_000 }));
    if (!/lares-e2e-ok/i.test(result.stdout)) throw new Error(`unexpected answer: ${result.stdout}`);
    return { answerMatched: true };
  });

  await attempt("router.key.quota.lifecycle", async () => {
    const issued = parseJson(await cli([
      "router", "key", "issue", prefix, "--ttl", "30m", "-o", "json",
    ]));
    const secret = issued.key ?? issued.api_key ?? issued.plaintext;
    runner.defer("router.key.revoke", async () => {
      expectOk(await cli(["router", "quota", "clear", "--key", prefix, "--yes"]));
      expectOk(await cli(["router", "key", "revoke", prefix, "--yes", "-o", "json"]));
      return { key: prefix };
    });
    expectOk(await cli(["router", "quota", "set", "--key", prefix, "--rpm", "7", "--tpm", "2048", "-o", "json"]));
    const keys = parseJson(await cli(["router", "key", "list", "-o", "json"]));
    if (!JSON.stringify(keys).includes(prefix)) throw new Error("issued key is absent from key list");
    return { name: prefix, plaintextReceived: Boolean(secret) };
  });

  await attempt("files.lifecycle", async () => {
    const source = join(temp, "payload.txt");
    const downloaded = join(temp, "downloaded.txt");
    await writeFile(source, `Lares E2E ${stamp}\n`);
    expectOk(await cli(["files", "mkdir", "-p", `${remoteRoot}/source`]));
    runner.defer("files.cleanup", async () => {
      expectOk(await cli(["files", "rm", "-rf", remoteRoot]));
      return { removed: remoteRoot };
    });
    expectOk(await cli(["files", "upload", source, `${remoteRoot}/source/payload.txt`]));
    const cat = expectOk(await cli(["files", "cat", `${remoteRoot}/source/payload.txt`]));
    if (!cat.stdout.includes(stamp)) throw new Error("uploaded file content mismatch");
    expectOk(await cli(["files", "mkdir", "-p", `${remoteRoot}/copies`]));
    expectOk(await cli(["files", "cp", `${remoteRoot}/source/payload.txt`, `${remoteRoot}/copies/`]));
    expectOk(await cli(["files", "rename", `${remoteRoot}/copies/payload.txt`, "renamed.txt"]));
    expectOk(await cli(["files", "mv", `${remoteRoot}/copies/renamed.txt`, `${remoteRoot}/source/`]));
    expectOk(await cli([
      "files", "compress", `${remoteRoot}/source/`, `${remoteRoot}/bundle.zip`, "--wait",
    ], { timeoutMs: 300_000 }));
    expectOk(await cli(["files", "archive", "entries", `${remoteRoot}/bundle.zip`]));
    expectOk(await cli(["files", "mkdir", "-p", `${remoteRoot}/extracted`]));
    expectOk(await cli([
      "files", "extract", `${remoteRoot}/bundle.zip`, `${remoteRoot}/extracted/`, "--wait",
    ], { timeoutMs: 300_000 }));
    expectOk(await cli(["files", "download", `${remoteRoot}/source/payload.txt`, downloaded]));
    return { root: remoteRoot, contentVerified: true };
  });

  await attempt("files.public-share", async () => {
    const created = expectOk(await cli([
      "files", "share", "public", `${remoteRoot}/source/`, "--expire-days", "1",
    ]));
    const id = created.stdout.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0];
    if (!id) throw new Error(`share id missing: ${created.stdout}`);
    runner.defer("files.share.remove", async () => {
      expectOk(await cli(["files", "share", "rm", id]));
      return { id };
    });
    expectOk(await cli(["files", "share", "get", id]));
    return { id };
  }, { optional: true });

  await attempt("search.drive", async () => {
    const result = expectOk(await cli(["search", "drive", "payload.txt", "--type", "file_name", "-o", "json"]));
    return { bytes: result.stdout.length };
  }, { optional: true });

  await attempt("settings.appearance.toggle", async () => {
    const current = expectOk(await cli(["settings", "appearance", "get"])).stdout;
    const original = current.includes("zh-CN") ? "zh-CN" : "en-US";
    const next = original === "en-US" ? "zh-CN" : "en-US";
    runner.defer("settings.appearance.restore", async () => {
      expectOk(await cli(["settings", "appearance", "language", "set", original]));
      return { locale: original };
    });
    expectOk(await cli(["settings", "appearance", "language", "set", next]));
    return { from: original, to: next };
  }, { optional: true });

  await attempt("settings.user.lifecycle", async () => {
    const username = `e2e${stamp.slice(-8)}`;
    const created = parseJson(await cli([
      "settings", "users", "create", username, "--defaults", "--watch",
      "--watch-timeout", "15m", "-o", "json",
    ], { timeoutMs: 960_000 }));
    runner.defer("settings.user.delete", async () => {
      expectOk(await cli([
        "settings", "users", "delete", username, "--yes", "--watch",
        "--watch-timeout", "15m", "-o", "json",
      ], { timeoutMs: 960_000 }));
      return { username };
    });
    expectOk(await cli(["settings", "users", "get", username, "-o", "json"]));
    return { username, accepted: Boolean(created) };
  }, { optional: true });

  await attempt("settings.search.rebuild", async () => {
    expectOk(await cli(["settings", "search", "status", "-o", "json"]));
    expectOk(await cli(["settings", "search", "rebuild"]));
    return { triggered: true };
  }, { optional: true });

  await attempt("market.lifecycle", async () => {
    const mine = parseJson(await cli(["market", "list", "--mine", "-o", "json"]));
    marketWasInstalled = jsonItems(mine).some((item) => (item.name ?? item.id) === marketApp);
    if (marketWasInstalled) throw new Error(`${marketApp} already installed; refusing destructive fixture reuse`);
    runner.defer("market.uninstall", async () => {
      if (!marketInstalled) return { skipped: "not installed" };
      expectOk(await cli([
        "market", "uninstall", marketApp, "--watch", "--delete-data",
        "--watch-timeout", "15m", "-o", "json",
      ], { timeoutMs: 960_000 }));
      return { app: marketApp };
    });
    expectOk(await cli([
      "market", "install", marketApp, "--watch", "--watch-timeout", "15m", "-o", "json",
    ], { timeoutMs: 960_000 }));
    marketInstalled = true;
    expectOk(await cli(["market", "status", marketApp, "-o", "json"]));
    expectOk(await cli(["market", "stop", marketApp, "--watch", "--watch-timeout", "5m", "-o", "json"], { timeoutMs: 360_000 }));
    expectOk(await cli(["market", "resume", marketApp, "--watch", "--watch-timeout", "5m", "-o", "json"], { timeoutMs: 360_000 }));
    expectOk(await cli(["market", "restart", marketApp, "--watch", "--watch-timeout", "5m", "-o", "json"], { timeoutMs: 360_000 }));
    return { app: marketApp };
  });

  await attempt("cluster.test-app", async () => {
    if (!marketInstalled) throw new Error("market fixture is unavailable");
    const workloads = parseJson(await cli(["cluster", "workload", "list", "-o", "json"]));
    const row = jsonItems(workloads).find((item) =>
      JSON.stringify(item).toLowerCase().includes(marketApp.toLowerCase()),
    );
    if (!row) throw new Error(`workload for ${marketApp} not found`);
    return { found: true };
  }, { optional: true });

  await attempt("knowledge.download.lifecycle", async () => {
    const created = parseJson(await cli([
      "knowledge", "download", "create", "https://www.w3.org/TR/PNG/iso_8859-1.txt",
      "--name", `${prefix}.txt`, "--path", `${remoteRoot}/`, "-o", "json",
    ]));
    const id = created.id ?? created.task_id ?? created.data?.id;
    if (!id) throw new Error("download task id missing");
    runner.defer("knowledge.download.remove", async () => {
      expectOk(await cli(["knowledge", "download", "remove", String(id)]));
      return { id };
    });
    const info = parseJson(await cli(["knowledge", "download", "info", String(id), "-o", "json"]));
    const status = String(info.status ?? info.data?.status ?? "").toLowerCase();
    if (status === "downloading" || status === "waiting") {
      expectOk(await cli(["knowledge", "download", "pause", String(id)]));
      expectOk(await cli(["knowledge", "download", "resume", String(id)]));
      expectOk(await cli(["knowledge", "download", "cancel", String(id)]));
    }
    return { id, status, lifecycle: status === "downloading" || status === "waiting" };
  }, { optional: true });
} finally {
  await runner.restore();
  await rm(temp, { recursive: true, force: true });
  const report = await runner.writeReport({
    target: { profile, marketApp },
  });
  console.log(JSON.stringify({ reportPath, summary: report.summary }, null, 2));
  if (report.summary.failed > 0 || report.summary["restore-failed"] > 0) {
    process.exitCode = 1;
  }
}
