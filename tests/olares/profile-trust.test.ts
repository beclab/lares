import assert from "node:assert/strict";
import test from "node:test";
import { lstatSync, mkdtempSync, mkdirSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  linkOwnedProfileDeps,
  sectionComponentNavIcon,
  trustOlaresConnectionHost,
} from "../../packages/service/dsh-web/profile.js";

const INTERCEPTOR =
  'if (interceptor.options.authority === "loopback" && !isTrustedApiRequest(request, []))';
const PRIVILEGED =
  "if (method !== void 0 && PRIVILEGED_METHODS.has(method) && !isTrustedApiRequest(request, []))";

test("Olares trusted hosts reach strict interceptors and privileged settings methods", () => {
  const patched = trustOlaresConnectionHost(`${INTERCEPTOR}\n${PRIVILEGED}`);
  assert.match(patched, /isTrustedApiRequest\(request, this\.trustedHosts\)/);
  assert.match(patched, /isTrustedApiRequest\(request, trustedHosts\)/);
  assert.doesNotMatch(patched, /isTrustedApiRequest\(request, \[\]\)/);
  assert.equal(trustOlaresConnectionHost(patched), patched);
});

test("connection trust patch fails loudly when upstream anchors drift", () => {
  assert.throws(
    () => trustOlaresConnectionHost("unrelated upstream source"),
    /trust patch anchor not found/,
  );
});

const SETTINGS_SHELL = [
  'rows = ctx.slots.entries("settings.section").map((e) => ({',
  "id: e.options.id ?? \"\",",
  "order: e.options.order ?? 0,",
  'label: (0, _deepseek_ai_dsh_client_ui_slots.resolveSlotLabel)(e.options.label) ?? ""',
  "}))",
  "function navIcon(id) {",
  'if (id === "models") return jsx(IconDataOutline16, {});',
  "children: [navIcon(row.id), jsx(\"span\", {})]",
].join("\n");

test("a settings section's own component supplies its nav glyph", () => {
  const patched = sectionComponentNavIcon(SETTINGS_SHELL);
  assert.match(patched, /icon: e\.component\?\.navIcon/);
  assert.match(patched, /function navIcon\(id, custom\)/);
  assert.match(patched, /custom !== void 0/);
  assert.match(patched, /navIcon\(row\.id, row\.icon\)/);
  assert.equal(sectionComponentNavIcon(patched), patched);
});

test("nav icon patch fails loudly when the settings shell drifts", () => {
  assert.throws(() => sectionComponentNavIcon("unrelated upstream source"), /anchor not found/);
});

test("Lares profile packages link to authoritative source directories", () => {
  const root = mkdtempSync(join(tmpdir(), "lares-profile-"));
  const profileDir = join(root, "profile");
  const source = join(root, "bundle-web");
  mkdirSync(source);

  try {
    linkOwnedProfileDeps(profileDir, [["@lares/bundle-web", source]]);
    const target = join(profileDir, "node_modules", "@lares", "bundle-web");
    assert.equal(lstatSync(target).isSymbolicLink(), true);
    assert.equal(readlinkSync(target), source);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
