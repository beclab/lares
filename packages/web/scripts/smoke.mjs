#!/usr/bin/env node
/**
 * Browser smoke check against a running lares server.
 *
 * Type checks and unit tests both pass on a build whose icon font is missing or
 * whose markdown plugin fails to register, because neither shows up as a type
 * error, a failed request, or a thrown exception. This loads the real bundle in
 * a real browser and asserts on what the user actually sees.
 *
 *   npm run smoke -w @lares/web -- http://127.0.0.1:30141
 */
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = (process.argv[2] ?? "http://127.0.0.1:30141").replace(/\/$/, "");
const shotPath = resolve(process.argv[3] ?? "smoke.png");

const ICON_FONT = "Material Symbols Outlined";
const SETTINGS_TABS = ["Providers", "Models", "Behaviour", "Skills", "Plugins", "Tools"];

const failures = [];
function check(ok, message) {
	if (ok) console.log(`  ok    ${message}`);
	else {
		console.log(`  FAIL  ${message}`);
		failures.push(message);
	}
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// Collected per navigation so a failure names the page it happened on.
let noise = [];
page.on("pageerror", (err) => noise.push(`uncaught: ${err.message}`));
page.on("console", (message) => {
	if (message.type() === "error") noise.push(`console: ${message.text()}`);
});
page.on("requestfailed", (request) => noise.push(`request failed: ${request.url()}`));
page.on("response", (response) => {
	if (response.status() >= 400) noise.push(`http ${response.status()}: ${response.url()}`);
});

async function visit(path) {
	noise = [];
	await page.goto(baseUrl + path, { waitUntil: "networkidle", timeout: 30_000 });
	await page.waitForTimeout(1500);
	check(
		noise.length === 0,
		`${path} loads without errors${noise.length ? ` (${[...new Set(noise)].join("; ")})` : ""}`,
	);
}

console.log(`smoke ${baseUrl}`);

await visit("/");
check((await page.locator("#q-app").innerHTML()).length > 500, "the chat shell renders");

// The failure this exists for: Quasar emits icon class names from `iconSet`
// while `extras` decides which font ships. When they disagree the page looks
// fine to every other check and every icon renders as its ligature name.
const iconFontLoaded = await page.evaluate((family) => document.fonts.check(`24px "${family}"`), ICON_FONT);
check(iconFontLoaded, `the ${ICON_FONT} font is loaded`);

const icon = await page.evaluate(() => {
	const element = document.querySelector("i.q-icon");
	if (!element) return null;
	const style = getComputedStyle(element);
	return { text: element.textContent?.trim() ?? "", fontFamily: style.fontFamily, fontStyle: style.fontStyle };
});
check(icon !== null, "the page renders at least one icon");
if (icon) {
	check(icon.fontFamily.includes(ICON_FONT), `icons resolve to ${ICON_FONT}, got ${icon.fontFamily}`);
	check(icon.fontStyle === "normal", `icons are not italic, got ${icon.fontStyle}`);
}

await visit("/settings");
for (const label of SETTINGS_TABS) {
	noise = [];
	const tab = page.getByRole("tab", { name: label }).first();
	if ((await tab.count()) === 0) {
		check(false, `settings tab ${label} exists`);
		continue;
	}
	await tab.click();
	await page.waitForTimeout(1200);
	check(
		noise.length === 0,
		`settings tab ${label} opens cleanly${noise.length ? ` (${[...new Set(noise)].join("; ")})` : ""}`,
	);
}

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
await mkdir(dirname(shotPath), { recursive: true });
await page.screenshot({ path: shotPath });
console.log(`screenshot ${shotPath}`);

await browser.close();

if (failures.length > 0) {
	console.error(`\n${failures.length} check(s) failed`);
	process.exit(1);
}
console.log("\nall checks passed");
