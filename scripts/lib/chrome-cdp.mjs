/**
 * Headless Chrome via CDP (no Playwright/Puppeteer dependency).
 *
 * Resolves a Chromium binary (env → Playwright cache → system), launches with
 * remote debugging, and exposes a small Page API for UI verification scripts.
 *
 *   import { withBrowser } from "./chrome-cdp.mjs";
 *   await withBrowser({ url: "http://127.0.0.1:8080/" }, async (page) => {
 *     await page.waitFor(() => document.querySelector("[data-phase]"), { timeout: 15_000 });
 *     await page.screenshot("/tmp/lares.png");
 *     console.log(await page.evaluate(() => document.title));
 *   });
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function playwrightCacheRoot() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (process.platform === "darwin") return join(homedir(), "Library/Caches/ms-playwright");
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData/Local"), "ms-playwright");
  }
  return join(homedir(), ".cache/ms-playwright");
}

function newestMatching(root, predicate) {
  if (!existsSync(root)) return null;
  const entries = readdirSync(root)
    .map((name) => {
      const full = join(root, name);
      try {
        return { name, full, mtime: statSync(full).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  for (const entry of entries) {
    const hit = predicate(entry);
    if (hit) return hit;
  }
  return null;
}

/**
 * @param {{ headed?: boolean }} [opts]
 * @returns {string}
 */
export function resolveChromeBin(opts = {}) {
  const envBin = process.env.CHROME_BIN || process.env.CHROMIUM_PATH || process.env.CHROME_PATH;
  if (envBin) {
    if (!existsSync(envBin)) throw new Error(`CHROME_BIN not found: ${envBin}`);
    return envBin;
  }

  const cache = playwrightCacheRoot();
  const headed = Boolean(opts.headed);

  if (!headed) {
    const shell = newestMatching(cache, (entry) => {
      if (!entry.name.startsWith("chromium_headless_shell-")) return null;
      const candidates = [
        join(entry.full, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
        join(entry.full, "chrome-headless-shell-mac-x64", "chrome-headless-shell"),
        join(entry.full, "chrome-headless-shell-linux64", "chrome-headless-shell"),
        join(entry.full, "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
      ];
      return candidates.find((p) => existsSync(p)) || null;
    });
    if (shell) return shell;
  }

  const chromeForTesting = newestMatching(cache, (entry) => {
    if (!entry.name.startsWith("chromium-")) return null;
    const candidates = [
      join(
        entry.full,
        "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      ),
      join(
        entry.full,
        "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      ),
      join(entry.full, "chrome-mac/Chromium.app/Contents/MacOS/Chromium"),
      join(entry.full, "chrome-linux/chrome"),
      join(entry.full, "chrome-linux64/chrome"),
      join(entry.full, "chrome-win64/chrome.exe"),
    ];
    return candidates.find((p) => existsSync(p)) || null;
  });
  if (chromeForTesting) return chromeForTesting;

  const system = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].find((p) => existsSync(p));
  if (system) return system;

  throw new Error(
    "No Chrome/Chromium found. Install Google Chrome, or set CHROME_BIN, or keep a Playwright browser cache under ~/Library/Caches/ms-playwright.",
  );
}

/**
 * Minimal CDP client over the page target WebSocket.
 */
export class CdpClient {
  /** @param {string} wsUrl */
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    /** @type {WebSocket | null} */
    this.ws = null;
    this.seq = 0;
    /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void }>} */
    this.pending = new Map();
    /** @type {Map<string, Set<(params: any) => void>>} */
    this.events = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", (err) => reject(err), { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (msg.method) {
        const listeners = this.events.get(msg.method);
        if (listeners) for (const fn of listeners) fn(msg.params);
      }
    });
  }

  /**
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   */
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error(`CDP not connected (${method})`));
        return;
      }
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** @param {string} method @param {(params: any) => void} fn */
  on(method, fn) {
    if (!this.events.has(method)) this.events.set(method, new Set());
    this.events.get(method).add(fn);
    return () => this.events.get(method)?.delete(fn);
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    for (const { reject } of this.pending.values()) {
      reject(new Error("CDP closed"));
    }
    this.pending.clear();
  }
}

/**
 * High-level page helpers on top of CdpClient.
 */
export class Page {
  /** @param {CdpClient} cdp @param {{ width: number, height: number, deviceScaleFactor: number }} viewport */
  constructor(cdp, viewport) {
    this.cdp = cdp;
    this.viewport = viewport;
  }

  /** @param {string} method @param {Record<string, unknown>} [params] */
  send(method, params) {
    return this.cdp.send(method, params);
  }

  /**
   * Evaluate an expression or function in the page. Functions are serialized.
   * @param {string | Function} expression
   * @param {unknown[]} [args]
   */
  async evaluate(expression, args = []) {
    let source;
    if (typeof expression === "function") {
      source = `Promise.resolve((${expression.toString()}).apply(null, ${JSON.stringify(args)}))`;
    } else {
      source = expression;
    }
    const result = await this.cdp.send("Runtime.evaluate", {
      expression: source,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      const text =
        result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        JSON.stringify(result.exceptionDetails);
      throw new Error(text);
    }
    return result.result?.value;
  }

  /** @param {string} url @param {{ waitUntil?: "load" | "networkidle" | "none", timeout?: number }} [opts] */
  async goto(url, opts = {}) {
    const waitUntil = opts.waitUntil ?? "load";
    const timeout = opts.timeout ?? 30_000;
    if (waitUntil === "none") {
      await this.cdp.send("Page.navigate", { url });
      return;
    }
    if (waitUntil === "load") {
      let off = () => {};
      const loaded = new Promise((resolve) => {
        off = this.cdp.on("Page.loadEventFired", () => resolve(undefined));
      });
      await this.cdp.send("Page.navigate", { url });
      // Fast documents (data:/about:blank) may complete before the event arrives.
      const ready = await this.evaluate(() => document.readyState);
      if (ready === "complete" || ready === "interactive") {
        off();
        return;
      }
      try {
        await Promise.race([
          loaded,
          sleep(timeout).then(() => {
            throw new Error(`Page.goto load timeout after ${timeout}ms: ${url}`);
          }),
        ]);
      } finally {
        off();
      }
      return;
    }
    // networkidle: no in-flight requests for 500ms (best-effort via Network domain).
    await this.cdp.send("Network.enable").catch(() => {});
    let inflight = 0;
    let idleSince = Date.now();
    const onReq = () => {
      inflight += 1;
      idleSince = 0;
    };
    const onDone = () => {
      inflight = Math.max(0, inflight - 1);
      if (inflight === 0) idleSince = Date.now();
    };
    const off1 = this.cdp.on("Network.requestWillBeSent", onReq);
    const off2 = this.cdp.on("Network.loadingFinished", onDone);
    const off3 = this.cdp.on("Network.loadingFailed", onDone);
    await this.cdp.send("Page.navigate", { url });
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (inflight === 0 && idleSince && Date.now() - idleSince >= 500) break;
      await sleep(50);
    }
    off1();
    off2();
    off3();
  }

  /**
   * Poll until predicate (page-side) returns truthy.
   * @param {string | Function} predicate
   * @param {{ timeout?: number, interval?: number }} [opts]
   */
  async waitFor(predicate, opts = {}) {
    const timeout = opts.timeout ?? 15_000;
    const interval = opts.interval ?? 200;
    const start = Date.now();
    let last;
    while (Date.now() - start < timeout) {
      last = await this.evaluate(predicate);
      if (last) return last;
      await sleep(interval);
    }
    throw new Error(`waitFor timed out after ${timeout}ms (last=${JSON.stringify(last)})`);
  }

  /** @param {number} ms */
  sleep(ms) {
    return sleep(ms);
  }

  /**
   * @param {string} [selector]
   * @param {{ path?: string, clip?: { x: number, y: number, width: number, height: number }, fullPage?: boolean }} [opts]
   * @returns {Promise<Buffer>}
   */
  async screenshot(pathOrOpts, maybeOpts) {
    /** @type {{ path?: string, clip?: any, fullPage?: boolean }} */
    let opts;
    if (typeof pathOrOpts === "string") {
      opts = { ...(maybeOpts || {}), path: pathOrOpts };
    } else {
      opts = pathOrOpts || {};
    }
    /** @type {Record<string, unknown>} */
    const params = { format: "png" };
    if (opts.clip) params.clip = { ...opts.clip, scale: 1 };
    if (opts.fullPage) {
      const metrics = await this.cdp.send("Page.getLayoutMetrics");
      const size = metrics.cssContentSize || metrics.contentSize;
      params.clip = { x: 0, y: 0, width: size.width, height: size.height, scale: 1 };
      params.captureBeyondViewport = true;
    }
    const { data } = await this.cdp.send("Page.captureScreenshot", params);
    const buf = Buffer.from(data, "base64");
    if (opts.path) writeFileSync(opts.path, buf);
    return buf;
  }

  /** Click center of element matching selector (DOM query in page). */
  async click(selector) {
    const box = await this.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
    }, [selector]);
    if (!box) throw new Error(`click: no element for ${selector}`);
    await this.mouseClick(box.x, box.y);
  }

  /** @param {number} x @param {number} y */
  async mouseClick(x, y) {
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await this.cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
  }

  /**
   * Focus selector and type text via CDP Input (more realistic than setting value).
   * @param {string} selector
   * @param {string} text
   * @param {{ clear?: boolean, delayMs?: number }} [opts]
   */
  async type(selector, text, opts = {}) {
    await this.evaluate(
      (sel, clear) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error(`type: no element for ${sel}`);
        el.focus();
        if (clear && "value" in el) {
          el.value = "";
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      },
      [selector, Boolean(opts.clear)],
    );
    const delay = opts.delayMs ?? 0;
    for (const ch of text) {
      await this.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", text: ch });
      await this.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", text: ch });
      if (delay) await sleep(delay);
    }
  }

  /** @param {string} key e.g. "Enter", "Escape", "Tab" */
  async press(key) {
    await this.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key });
    await this.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key });
  }

  /** Dump a compact DOM snapshot for debugging. */
  async probe(selector = "body") {
    return this.evaluate((sel) => {
      const root = document.querySelector(sel) || document.body;
      const walk = (el, depth) => {
        if (!el || depth > 6) return null;
        const kids = [...el.children].slice(0, 40).map((c) => walk(c, depth + 1)).filter(Boolean);
        return {
          tag: el.tagName,
          id: el.id || undefined,
          class: typeof el.className === "string" ? el.className.slice(0, 120) : undefined,
          text: (el.childElementCount === 0 ? el.textContent || "" : "").trim().slice(0, 80) || undefined,
          attrs: Object.fromEntries(
            [...el.attributes]
              .filter((a) => a.name.startsWith("data-") || a.name === "role" || a.name.startsWith("aria-"))
              .slice(0, 12)
              .map((a) => [a.name, a.value.slice(0, 80)]),
          ),
          children: kids.length ? kids : undefined,
        };
      };
      return walk(root, 0);
    }, [selector]);
  }
}

/**
 * @typedef {object} LaunchOptions
 * @property {boolean} [headed]
 * @property {number} [port] remote debugging port (0 = ephemeral)
 * @property {string} [userDataDir]
 * @property {boolean} [keepProfile]
 * @property {number} [width]
 * @property {number} [height]
 * @property {number} [deviceScaleFactor]
 * @property {string[]} [chromeArgs]
 * @property {string} [bin]
 */

/**
 * @typedef {object} BrowserSession
 * @property {import("node:child_process").ChildProcess | null} process
 * @property {number} port
 * @property {string} userDataDir
 * @property {boolean} ownedProfile
 * @property {CdpClient} cdp
 * @property {Page} page
 * @property {() => Promise<void>} close
 */

/**
 * @param {LaunchOptions} [opts]
 * @returns {Promise<BrowserSession>}
 */
export async function launchBrowser(opts = {}) {
  const headed = Boolean(opts.headed);
  const width = opts.width ?? 1440;
  const height = opts.height ?? 900;
  const deviceScaleFactor = opts.deviceScaleFactor ?? 2;
  const bin = opts.bin || resolveChromeBin({ headed });
  const port = opts.port && opts.port > 0 ? opts.port : await pickFreePort();
  const ownedProfile = !opts.userDataDir;
  const userDataDir =
    opts.userDataDir || mkdtempSync(join(tmpdir(), "lares-chrome-"));

  const isHeadlessShell = /chrome-headless-shell/i.test(bin);
  if (headed && isHeadlessShell) {
    throw new Error(
      "CHROME_BIN points at chrome-headless-shell; use Chrome for Testing / system Chrome with --headed (or unset CHROME_BIN).",
    );
  }
  const args = [
    ...(headed ? [] : isHeadlessShell ? ["--headless"] : ["--headless=new"]),
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    ...(opts.chromeArgs || []),
    "about:blank",
  ];

  const child = spawn(bin, args, {
    stdio: "ignore",
    env: { ...process.env },
    detached: process.platform !== "win32",
  });

  const wsUrl = await waitForDebuggerUrl(port, {
    timeout: 20_000,
    child,
    stderr: () => "",
  });
  const cdp = new CdpClient(wsUrl);
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor,
    mobile: false,
  });

  const page = new Page(cdp, { width, height, deviceScaleFactor });

  const close = async () => {
    // Do not await Browser.close — headless-shell often never replies.
    try {
      cdp.send("Browser.close").catch(() => {});
    } catch {
      /* ignore */
    }
    try {
      cdp.close();
    } catch {
      /* ignore */
    }
    if (child.exitCode == null && child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
      await Promise.race([
        new Promise((r) => child.once("exit", r)),
        sleep(500),
      ]);
    }
    if (ownedProfile && !opts.keepProfile) {
      try {
        rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  };

  return { process: child, port, userDataDir, ownedProfile, cdp, page, close };
}

/**
 * Attach to an already-running Chrome (`--remote-debugging-port`).
 * @param {{ port?: number, host?: string, width?: number, height?: number, deviceScaleFactor?: number }} [opts]
 * @returns {Promise<BrowserSession>}
 */
export async function attachBrowser(opts = {}) {
  const host = opts.host || "127.0.0.1";
  const port = opts.port || Number(process.env.CDP_PORT || 9222);
  const width = opts.width ?? 1440;
  const height = opts.height ?? 900;
  const deviceScaleFactor = opts.deviceScaleFactor ?? 2;
  const wsUrl = await waitForDebuggerUrl(port, { host, timeout: 5_000 });
  const cdp = new CdpClient(wsUrl);
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor,
    mobile: false,
  });
  const page = new Page(cdp, { width, height, deviceScaleFactor });
  return {
    process: null,
    port,
    userDataDir: "",
    ownedProfile: false,
    cdp,
    page,
    close: async () => {
      cdp.close();
    },
  };
}

/**
 * Launch (or attach), optionally navigate, run fn, always close.
 *
 * @template T
 * @param {LaunchOptions & {
 *   url?: string,
 *   waitMs?: number,
 *   attach?: boolean,
 *   attachPort?: number,
 * }} opts
 * @param {(page: Page, session: BrowserSession) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withBrowser(opts, fn) {
  const session = opts.attach
    ? await attachBrowser({
        port: opts.attachPort || opts.port,
        width: opts.width,
        height: opts.height,
        deviceScaleFactor: opts.deviceScaleFactor,
      })
    : await launchBrowser(opts);
  try {
    if (opts.url) {
      await session.page.goto(opts.url, { waitUntil: "load" });
      if (opts.waitMs) await sleep(opts.waitMs);
    }
    return await fn(session.page, session);
  } finally {
    await session.close();
  }
}

async function pickFreePort() {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("failed to allocate port"));
        return;
      }
      const { port } = addr;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on("error", reject);
  });
}

/**
 * @param {number} port
 * @param {{ host?: string, timeout?: number, child?: import("node:child_process").ChildProcess, stderr?: () => string }} [opts]
 */
async function waitForDebuggerUrl(port, opts = {}) {
  const host = opts.host || "127.0.0.1";
  const timeout = opts.timeout ?? 20_000;
  const start = Date.now();
  let lastErr = "";
  while (Date.now() - start < timeout) {
    if (opts.child && opts.child.exitCode != null) {
      throw new Error(
        `Chrome exited early (code=${opts.child.exitCode}): ${opts.stderr?.() || ""}`,
      );
    }
    try {
      const res = await fetch(`http://${host}:${port}/json/list`);
      const list = await res.json();
      const page =
        list.find((t) => t.type === "page" && t.webSocketDebuggerUrl) ||
        list.find((t) => t.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      lastErr = `no page target yet (${list.length} targets)`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await sleep(200);
  }
  throw new Error(`CDP not ready on ${host}:${port}: ${lastErr}`);
}

/** Resolve a scenario module path to a file URL for dynamic import. */
export function resolveScenarioUrl(spec) {
  if (spec.startsWith("file:")) return spec;
  if (existsSync(spec)) return pathToFileURL(spec).href;
  const fromCwd = join(process.cwd(), spec);
  if (existsSync(fromCwd)) return pathToFileURL(fromCwd).href;
  const here = dirname(fileURLToPath(import.meta.url));
  const fromScripts = join(here, "..", spec);
  if (existsSync(fromScripts)) return pathToFileURL(fromScripts).href;
  throw new Error(`scenario not found: ${spec}`);
}
