import { spawn } from "node:child_process";

export function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      stdio: [options.stdin == null ? "ignore" : "pipe", "pipe", "pipe"],
      timeout: options.timeoutMs ?? 60_000,
    });
    const output = [];
    const errors = [];
    let size = 0;
    const collect = (target) => (chunk) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) { child.kill(); return; }
      target.push(chunk);
    };
    child.stdout.on("data", collect(output));
    child.stderr.on("data", collect(errors));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && size <= 4 * 1024 * 1024) resolve(Buffer.concat(output).toString("utf8"));
      else reject(new Error(Buffer.concat(errors).toString("utf8") || `process exited ${code}`));
    });
    if (options.stdin != null) {
      child.stdin.on("error", () => {});
      child.stdin.end(options.stdin);
    }
  });
}
