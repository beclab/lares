/**
 * Example scenario for `scripts/browser.mjs run`.
 *
 *   scripts/browser.mjs run scripts/browser-scenarios/example.mjs \\
 *     --url http://127.0.0.1:8080/ --wait 5000
 *
 * Export either `default` or `run`. Receives (page, session).
 * page API: goto, evaluate, waitFor, screenshot, click, type, press, probe, sleep
 */

/** @param {import("../lib/chrome-cdp.mjs").Page} page */
export default async function (page) {
  const title = await page.evaluate(() => document.title);
  const phase = await page.evaluate(
    () => document.querySelector("[data-phase]")?.getAttribute("data-phase") ?? null,
  );
  const out = `/tmp/lares-browser-example.png`;
  await page.screenshot(out);
  return { title, phase, screenshot: out };
}
