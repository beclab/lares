#!/usr/bin/env node
/**
 * Reusable headless Chrome driver for UI verification.
 *
 * Commands:
 *   scripts/browser.mjs shot <url> -o <png> [--wait ms] [--headed] [--full]
 *   scripts/browser.mjs eval <url> <js> [--wait ms] [--json]
 *   scripts/browser.mjs probe <url> [css-selector] [--wait ms]
 *   scripts/browser.mjs run <scenario.mjs> [--url ...]   # default export(page, session)
 *   scripts/browser.mjs bin                             # print resolved Chrome path
 *
 * Env:
 *   APP_URL / URL     default page URL
 *   CHROME_BIN        force Chromium binary
 *   CDP_PORT          with --attach, connect instead of launching
 *   WAIT_MS           default post-navigation settle time (ms)
 *
 * Scenario modules (run):
 *   export default async function (page, session) { ... }
 *   // or: export async function run(page, session) { ... }
 *
 * Library (from other scripts):
 *   import { withBrowser } from "./lib/chrome-cdp.mjs";
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  attachBrowser,
  launchBrowser,
  resolveChromeBin,
  resolveScenarioUrl,
  withBrowser,
} from "./lib/chrome-cdp.mjs";

function usage(code = 0) {
  const text = `Usage:
  scripts/browser.mjs shot <url> -o <file.png> [options]
  scripts/browser.mjs eval <url> <expression> [options]
  scripts/browser.mjs probe <url> [selector] [options]
  scripts/browser.mjs run <scenario.mjs> [options]
  scripts/browser.mjs bin [--headed]

Options:
  --wait <ms>       settle after navigation (default: WAIT_MS or 3000)
  --headed          visible window (uses Chrome for Testing / system Chrome)
  --attach          connect to existing --remote-debugging-port (CDP_PORT/9222)
  --port <n>        debugging port (launch or attach)
  --width <n>       viewport width (default 1440)
  --height <n>      viewport height (default 900)
  --scale <n>       deviceScaleFactor (default 2)
  --full            full-page screenshot (shot only)
  --clip <json>     screenshot clip {x,y,width,height}
  --json            pretty-print eval/probe result
  --insecure        accept self-signed certs (Olares *.olares.local entrances)
  --profile <dir>   reuse a Chrome user-data-dir
  --keep-profile    do not delete temp profile on exit
  -o, --out <path>  screenshot path (shot) or dump path (eval/probe)

Examples:
  scripts/browser.mjs shot http://127.0.0.1:8080/ -o /tmp/dina.png --wait 5000
  scripts/browser.mjs eval http://127.0.0.1:8080/ 'document.title'
  scripts/browser.mjs probe http://127.0.0.1:8080/ '[data-phase]' --wait 8000
  scripts/browser.mjs run scripts/browser-scenarios/example.mjs --url http://127.0.0.1:8080/
`;
  process.stderr.write(text);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      args.flags.help = true;
      continue;
    }
    if (a === "--headed") {
      args.flags.headed = true;
      continue;
    }
    if (a === "--attach") {
      args.flags.attach = true;
      continue;
    }
    if (a === "--full") {
      args.flags.full = true;
      continue;
    }
    if (a === "--json") {
      args.flags.json = true;
      continue;
    }
    if (a === "--keep-profile") {
      args.flags.keepProfile = true;
      continue;
    }
    if (a === "--insecure") {
      args.flags.insecure = true;
      continue;
    }
    const take = (name) => {
      const v = argv[++i];
      if (v == null) throw new Error(`missing value for ${name}`);
      return v;
    };
    if (a === "-o" || a === "--out") {
      args.flags.out = take(a);
      continue;
    }
    if (a === "--wait") {
      args.flags.wait = Number(take(a));
      continue;
    }
    if (a === "--port") {
      args.flags.port = Number(take(a));
      continue;
    }
    if (a === "--width") {
      args.flags.width = Number(take(a));
      continue;
    }
    if (a === "--height") {
      args.flags.height = Number(take(a));
      continue;
    }
    if (a === "--scale") {
      args.flags.scale = Number(take(a));
      continue;
    }
    if (a === "--clip") {
      args.flags.clip = JSON.parse(take(a));
      continue;
    }
    if (a === "--profile") {
      args.flags.profile = take(a);
      continue;
    }
    if (a === "--url") {
      args.flags.url = take(a);
      continue;
    }
    if (a.startsWith("-")) throw new Error(`unknown flag: ${a}`);
    args._.push(a);
  }
  return args;
}

function commonLaunch(flags) {
  return {
    headed: Boolean(flags.headed),
    port: flags.port,
    width: flags.width,
    height: flags.height,
    deviceScaleFactor: flags.scale,
    userDataDir: flags.profile,
    keepProfile: Boolean(flags.keepProfile),
    chromeArgs: flags.insecure ? ["--ignore-certificate-errors"] : undefined,
    attach: Boolean(flags.attach),
    attachPort: flags.port || Number(process.env.CDP_PORT || 0) || undefined,
  };
}

function defaultUrl(positional, flags) {
  return (
    flags.url ||
    positional ||
    process.env.APP_URL ||
    process.env.URL ||
    "http://127.0.0.1:8080/"
  );
}

function defaultWait(flags) {
  if (flags.wait != null && !Number.isNaN(flags.wait)) return flags.wait;
  if (process.env.WAIT_MS) return Number(process.env.WAIT_MS);
  return 3000;
}

async function cmdBin(flags) {
  console.log(resolveChromeBin({ headed: Boolean(flags.headed) }));
}

async function cmdShot(args) {
  const url = defaultUrl(args._[0], args.flags);
  const out = args.flags.out;
  if (!out) throw new Error("shot requires -o/--out <file.png>");
  await withBrowser(
    { ...commonLaunch(args.flags), url, waitMs: defaultWait(args.flags) },
    async (page) => {
      await page.screenshot({
        path: resolve(out),
        fullPage: Boolean(args.flags.full),
        clip: args.flags.clip,
      });
      console.log(resolve(out));
    },
  );
}

async function cmdEval(args) {
  const url = defaultUrl(args._[0], args.flags);
  const expression = args._[1];
  if (!expression) throw new Error("eval requires <expression>");
  const value = await withBrowser(
    { ...commonLaunch(args.flags), url, waitMs: defaultWait(args.flags) },
    (page) => page.evaluate(expression),
  );
  const text = args.flags.json ? JSON.stringify(value, null, 2) : stringify(value);
  if (args.flags.out) writeFileSync(resolve(args.flags.out), text + "\n");
  console.log(text);
}

async function cmdProbe(args) {
  const url = defaultUrl(args._[0], args.flags);
  const selector = args._[1] || "body";
  const value = await withBrowser(
    { ...commonLaunch(args.flags), url, waitMs: defaultWait(args.flags) },
    (page) => page.probe(selector),
  );
  const text = JSON.stringify(value, null, 2);
  if (args.flags.out) writeFileSync(resolve(args.flags.out), text + "\n");
  console.log(text);
}

async function cmdRun(args) {
  const scenario = args._[0];
  if (!scenario) throw new Error("run requires <scenario.mjs>");
  const mod = await import(resolveScenarioUrl(scenario));
  const fn = mod.default || mod.run;
  if (typeof fn !== "function") {
    throw new Error(`${scenario} must export default async function(page, session)`);
  }
  const url = args.flags.url || process.env.APP_URL || process.env.URL || undefined;
  const launch = commonLaunch(args.flags);
  const session = launch.attach
    ? await attachBrowser({
        port: launch.attachPort,
        width: launch.width,
        height: launch.height,
        deviceScaleFactor: launch.deviceScaleFactor,
      })
    : await launchBrowser(launch);
  try {
    if (url) {
      await session.page.goto(url, { waitUntil: "load" });
      const wait = defaultWait(args.flags);
      if (wait) await session.page.sleep(wait);
    }
    const result = await fn(session.page, session);
    if (result !== undefined) console.log(stringify(result));
  } finally {
    await session.close();
  }
}

function stringify(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) usage(1);
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    usage(1);
    return;
  }
  if (args.flags.help) usage(0);

  const cmd = args._.shift();
  try {
    if (cmd === "bin") await cmdBin(args.flags);
    else if (cmd === "shot") await cmdShot(args);
    else if (cmd === "eval") await cmdEval(args);
    else if (cmd === "probe") await cmdProbe(args);
    else if (cmd === "run") await cmdRun(args);
    else {
      console.error(`unknown command: ${cmd}`);
      usage(1);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.stack || err.message : err);
    process.exitCode = 1;
  }
}

main().finally(() => {
  // Chrome's CDP websocket can keep the event loop alive after kill.
  setTimeout(() => process.exit(process.exitCode ?? 0), 0).unref();
});
