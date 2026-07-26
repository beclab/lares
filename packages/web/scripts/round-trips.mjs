#!/usr/bin/env node
/**
 * Counts the API requests each chat action costs, against a running server.
 *
 * Every request to a deployed Olares app pays for the ingress round trip, so
 * what makes the UI feel slow is how many requests an action makes, not how
 * fast any one of them is. Nothing else in the suite notices when an action
 * grows an extra call: types still check, tests still pass, the screen still
 * shows the right thing, just later. This asserts the counts directly.
 *
 *   npm run round-trips -w @lares/web -- http://127.0.0.1:30199
 */
import { chromium } from "playwright";

const baseUrl = (process.argv[2] ?? "http://127.0.0.1:30199").replace(/\/$/, "");

/** Sending a prompt is one POST. State rides back on the response. */
const SEND_BUDGET = 1;
/** Opening a session is one GET. State rides in on the stream handshake. */
const OPEN_BUDGET = 1;
/** Roughly what the Olares ingress adds to every request from outside. */
const INGRESS_DELAY_MS = 600;

const FIRST_PROMPT = "first prompt";
const SECOND_PROMPT = "prompt in a second session";

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

/**
 * Event streams stay open for the life of a session, so they are counted when
 * opened but never waited on.
 */
let calls = [];
page.on("request", (request) => {
	const url = new URL(request.url());
	if (url.pathname.startsWith("/api/")) calls.push(`${request.method()} ${url.pathname}${url.search}`);
});

function record() {
	calls = [];
	return () => calls;
}

console.log(`round-trips ${baseUrl}`);

await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30_000 });
await page.waitForTimeout(1000);

const sidebar = page.getByRole("complementary");

async function newSession() {
	await sidebar.getByRole("button", { name: "New session" }).click();
	await page.waitForTimeout(2000);
	await page.locator("textarea").first().waitFor({ timeout: 10_000 });
}

async function openFromSidebar(index) {
	await page.locator(".q-drawer .q-item--clickable").nth(index).click();
}

async function send(text) {
	const composer = page.locator("textarea").first();
	const taken = record();
	await composer.fill(text);
	await composer.press("Enter");
	await page.waitForFunction((needle) => document.body.innerText.includes(needle), "Hello from the mock gateway.", {
		timeout: 30_000,
	});
	await page.waitForTimeout(2500);
	return taken().filter((call) => !call.includes("/events"));
}

await newSession();
// A new session has no file on disk yet, so its first turn is allowed the one
// extra list fetch that puts it in the sidebar. The second turn is the steady
// state that the budget describes.
await send(FIRST_PROMPT);
const sendCalls = await send("second prompt");
check(
	sendCalls.length === SEND_BUDGET,
	`sending a prompt costs ${SEND_BUDGET} request, got ${sendCalls.length}: ${sendCalls.join(", ") || "none"}`,
);

// Switching needs somewhere to switch to, and the target has to be on disk.
await newSession();
await send(SECOND_PROMPT);

// Sessions are listed newest first, so the one just used sits at 0 and the
// earlier one at 1. Switching means clicking the one we are not on.
const NEWEST = 0;
const EARLIER = 1;

const openTaken = record();
await openFromSidebar(EARLIER);
await page.waitForTimeout(2500);
const openCalls = openTaken().filter((call) => !call.includes("/events"));
check(
	openCalls.length <= OPEN_BUDGET,
	`opening a session costs ${OPEN_BUDGET} request, got ${openCalls.length}: ${openCalls.join(", ") || "none"}`,
);

// The request count is the same whether or not a transcript is cached, because
// the cached path still revalidates. What the cache buys is that the paint no
// longer waits on the network, which only shows up once the network costs
// something, so stand in for the ingress round trip.
await page.route("**/api/sessions/*", async (route) => {
	await new Promise((resolve) => setTimeout(resolve, INGRESS_DELAY_MS));
	await route.continue();
});

/** Milliseconds until a session's own transcript is on screen. */
async function timeToPaint(index, marker) {
	await openFromSidebar(index);
	const started = Date.now();
	await page.locator(".message-list", { hasText: marker }).first().waitFor({ timeout: 30_000 });
	return Date.now() - started;
}

// The cache lives only as long as the page, so a reload empties it. We land
// back on the earlier session, which makes the newest one the uncached one.
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1000);
const cold = await timeToPaint(NEWEST, SECOND_PROMPT);
check(
	cold >= INGRESS_DELAY_MS,
	`an uncached session waits for the network, took ${cold}ms with a ${INGRESS_DELAY_MS}ms delay`,
);

// Leaving a session caches it, so the one we just came from is now warm.
const warm = await timeToPaint(EARLIER, FIRST_PROMPT);
check(
	warm < INGRESS_DELAY_MS,
	`a cached session paints before the network answers, took ${warm}ms with a ${INGRESS_DELAY_MS}ms delay`,
);

await browser.close();

if (failures.length > 0) {
	console.error(`\n${failures.length} check(s) failed`);
	process.exit(1);
}
console.log("\nall checks passed");
