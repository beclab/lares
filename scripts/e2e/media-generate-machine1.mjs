import { readFile } from "node:fs/promises";
import { E2ERunner, command, expectOk } from "./lib/runner.mjs";

const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const prefix = `lares-e2e-media-${stamp}`;
const resultPath = `/tmp/${prefix}.json`;
const reportPath = process.env.LARES_E2E_REPORT ?? `/tmp/${prefix}-report.json`;
const runner = new E2ERunner({ reportPath, prefix });

try {
  const result = await runner.check("media.generate.preview", async () => {
    expectOk(await command([
      process.execPath,
      `${process.env.HOME}/.cursor/skills/olares-browser-login/scripts/session.mjs`,
      "run",
      "scripts/browser-scenarios/lares-media-generate.mjs",
      "--machine", "1",
      "--wait", "5000",
      "--insecure",
    ], {
      cwd: process.cwd(),
      timeoutMs: 18 * 60_000,
      env: {
        ...process.env,
        OLARES_NO_DIALOG: "1",
        LARES_E2E_RESULT: resultPath,
      },
    }));
    return JSON.parse(await readFile(resultPath, "utf8"));
  });

  if (/^(drive|sync|external|cache|awss3|google|dropbox|tencent)\//.test(result.path)) {
    runner.defer("media.generated-file.remove", async () => {
      expectOk(await command([
        "olares-cli", "files", "rm", "-f", result.path,
      ], { timeoutMs: 180_000 }));
      return { path: result.path };
    });
  } else {
    runner.results.push({
      id: "media.generated-file.remove",
      status: "skipped",
      durationMs: 0,
      detail: `workspace-relative cleanup requires session cwd: ${result.path}`,
    });
  }
} finally {
  await runner.restore();
  const report = await runner.writeReport();
  console.log(JSON.stringify({ reportPath, summary: report.summary }, null, 2));
  if (report.summary.failed > 0 || report.summary["restore-failed"] > 0) {
    process.exitCode = 1;
  }
}
