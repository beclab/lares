import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isMobileIndexPath,
  isMobileUserAgent,
  resolveSpaSurface,
  spaCacheControl,
  UI_COOKIE_NAME,
  uiCookieHeader,
} from "../../packages/core/entrance/surface.js";

const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";

test("desktop user agents stay on the pc shell", () => {
  assert.equal(isMobileUserAgent(DESKTOP), false);
  assert.equal(isMobileUserAgent(""), false);
  assert.equal(isMobileUserAgent(undefined), false);
});

test("phones and tablets resolve to the mobile shell", () => {
  assert.equal(isMobileUserAgent(IPHONE), true);
  assert.equal(isMobileUserAgent(
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Mobile Safari/537.36",
  ), true);
  assert.equal(isMobileUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Mobile/15E148"), true);
});

test("?ui= wins and remembers the choice", () => {
  const forced = resolveSpaSurface({ userAgent: DESKTOP, query: "ui=mobile" });
  assert.deepEqual(forced, { surface: "mobile", setCookie: "mobile" });
  assert.equal(resolveSpaSurface({ userAgent: DESKTOP, query: "foo=1&bar=ui=mobile" }).surface, "pc");
  assert.equal(resolveSpaSurface({ userAgent: IPHONE, query: "ui=pc" }).surface, "pc");
});

test("cookie then client hint then user agent", () => {
  assert.equal(
    resolveSpaSurface({ userAgent: DESKTOP, cookie: `${UI_COOKIE_NAME}=mobile; other=1` }).surface,
    "mobile",
  );
  assert.equal(resolveSpaSurface({ userAgent: DESKTOP, cookie: `${UI_COOKIE_NAME}=mobile` }).setCookie, null);
  assert.equal(resolveSpaSurface({ userAgent: DESKTOP, clientHint: "?1" }).surface, "mobile");
  assert.equal(resolveSpaSurface({ userAgent: IPHONE }).surface, "mobile");
  assert.equal(resolveSpaSurface({ userAgent: DESKTOP }).surface, "pc");
});

test("ui cookie is sticky for later asset requests on the same host", () => {
  const header = uiCookieHeader("mobile");
  assert.match(header, new RegExp(`^${UI_COOKIE_NAME}=mobile;`));
  assert.match(header, /Path=\//);
  assert.match(header, /SameSite=Lax/);
});

test("page paths fall back to the shell and hashed assets do not", () => {
  assert.equal(isMobileIndexPath("/"), true);
  assert.equal(isMobileIndexPath("/index.html"), true);
  assert.equal(isMobileIndexPath("/session/abc"), true);
  assert.equal(isMobileIndexPath("/assets/index-abc.js"), false);
  assert.equal(isMobileIndexPath("/assets/index-abc.css"), false);
  assert.match(spaCacheControl("/"), /no-store/);
  assert.match(spaCacheControl("/index.html"), /no-store/);
  assert.match(spaCacheControl("/assets/index-abc.js"), /immutable/);
});

test("the entrance fallback serves the phone shell on the same host", () => {
  const patch = readFileSync(new URL("../../packages/web/dsh-overlay/cordis.patch.yml", import.meta.url), "utf8");
  const host = readFileSync(new URL("../../packages/web/dsh-overlay/host/mobile-surface.js", import.meta.url), "utf8");
  const entry = readFileSync(new URL("../../packages/mobile/entrance/main.js", import.meta.url), "utf8");
  assert.match(patch, /lares-mobile-surface/);
  assert.match(host, /server\.fallback = wrapped/);
  assert.match(host, /authorizeIndex/);
  assert.match(host, /mobile\/dist/);
  assert.doesNotMatch(entry, /larepass|baseUrl/);
  assert.match(entry, /device: "mobile"/);
});
