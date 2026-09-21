import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

function now() {
  return new Date().toISOString();
}

export async function command(argv, options = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    input,
    timeoutMs = 120_000,
    redact = [],
  } = options;
  const started = Date.now();
  return await new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const scrub = (text) => redact.reduce(
        (value, secret) => secret ? value.replaceAll(secret, "[REDACTED]") : value,
        text,
      );
      resolve({
        argv: argv.map((part) => redact.includes(part) ? "[REDACTED]" : part),
        code: code ?? 1,
        signal,
        stdout: scrub(stdout),
        stderr: scrub(stderr),
        durationMs: Date.now() - started,
      });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

export function parseJson(result) {
  if (result.code !== 0) {
    throw new Error(`${result.argv.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

export class E2ERunner {
  constructor({ reportPath, prefix }) {
    this.reportPath = reportPath;
    this.prefix = prefix;
    this.results = [];
    this.cleanups = [];
    this.startedAt = now();
  }

  async check(id, run, options = {}) {
    const started = Date.now();
    try {
      const detail = await run();
      const status = options.status ?? "passed";
      this.results.push({ id, status, durationMs: Date.now() - started, detail });
      return detail;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const status = options.optional ? "skipped" : "failed";
      this.results.push({ id, status, durationMs: Date.now() - started, detail });
      if (!options.optional) throw error;
      return undefined;
    }
  }

  defer(id, cleanup) {
    this.cleanups.push({ id, cleanup });
  }

  async restore() {
    while (this.cleanups.length > 0) {
      const item = this.cleanups.pop();
      const started = Date.now();
      try {
        const detail = await item.cleanup();
        this.results.push({
          id: item.id,
          status: "restored",
          durationMs: Date.now() - started,
          detail,
        });
      } catch (error) {
        this.results.push({
          id: item.id,
          status: "restore-failed",
          durationMs: Date.now() - started,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  async writeReport(extra = {}) {
    const report = {
      prefix: this.prefix,
      startedAt: this.startedAt,
      finishedAt: now(),
      results: this.results,
      summary: Object.fromEntries(
        ["passed", "failed", "skipped", "restored", "restore-failed"].map((status) => [
          status,
          this.results.filter((item) => item.status === status).length,
        ]),
      ),
      ...extra,
    };
    await writeFile(this.reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return report;
  }
}

export function expectOk(result, label = result.argv.join(" ")) {
  if (result.code !== 0) {
    throw new Error(`${label}: ${result.stderr || result.stdout}`);
  }
  return result;
}
