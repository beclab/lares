import assert from "node:assert/strict";
import test from "node:test";
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureLaresWebProfile,
  linkOwnedProfileDeps,
  sectionComponentNavIcon,
  trustOlaresConnectionClient,
  useEnglishLocaleDefault,
  useOlaresDocumentLanguage,
} from "../../packages/service/dsh-web/profile.js";

const CLIENT_LOOPBACK =
  "isLoopback: transport?.ownsHost === true || pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname),";

test("the served client reports the privileged surface as reachable", () => {
  const patched = trustOlaresConnectionClient(CLIENT_LOOPBACK);
  assert.equal(patched, "isLoopback: true,");
  assert.equal(trustOlaresConnectionClient(patched), patched);
});

test("connection trust patch fails loudly when upstream anchors drift", () => {
  assert.throws(
    () => trustOlaresConnectionClient("unrelated upstream source"),
    /trust patch anchor not found/,
  );
});

test("an unset language preference defaults to English", () => {
  const upstream = "this.provisional = resolveInitialLocale(locales);";
  const patched = useEnglishLocaleDefault(upstream);
  assert.equal(patched, 'this.provisional = "en";/* lares-default-locale */');
  assert.equal(useEnglishLocaleDefault(patched), patched);
});

test("locale default patch fails loudly when upstream anchors drift", () => {
  assert.throws(() => useEnglishLocaleDefault("unrelated upstream source"), /anchor not found/);
});

test("document language tags use the same locale symbols as Olares", () => {
  const upstream =
    'document.documentElement.lang = snapshot.active === "zh" ? "zh-CN" : snapshot.active;';
  const patched = useOlaresDocumentLanguage(upstream);
  assert.equal(
    patched,
    'document.documentElement.lang = snapshot.active === "zh" ? "zh-CN" : snapshot.active === "en" ? "en-US" : snapshot.active;/* lares-document-language */',
  );
  assert.equal(useOlaresDocumentLanguage(patched), patched);
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
  const source = join(root, "dsh-overlay");
  mkdirSync(source);

  try {
    linkOwnedProfileDeps(profileDir, [["@lares/dsh-overlay", source]]);
    const target = join(profileDir, "node_modules", "@lares", "dsh-overlay");
    assert.equal(lstatSync(target).isSymbolicLink(), true);
    assert.equal(readlinkSync(target), source);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Lares profile refresh drops retired first-party bundles", () => {
  const root = mkdtempSync(join(tmpdir(), "lares-profile-"));
  const profileDir = join(root, "dsh-home", "profiles", "lares-web");
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(
    join(profileDir, "package.json"),
    JSON.stringify({
      dependencies: {
        "@lares/bundle-web": "file:/old/bundle-web",
        "community-bundle": "1.0.0",
      },
      dsh: {
        profile: {
          bundles: [
            "@deepseek-ai/dsh-base",
            "@deepseek-ai/dsh-web-app",
            "community-bundle",
            "@lares/bundle-web",
          ],
        },
      },
    }),
  );

  try {
    ensureLaresWebProfile(root);
    const manifest = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8"));
    assert.equal(manifest.dependencies["@lares/bundle-web"], undefined);
    assert.equal(manifest.dependencies["community-bundle"], "1.0.0");
    assert.match(String(manifest.dependencies["@lares/dsh-overlay"]), /\/packages\/web\/dsh-overlay$/);
    assert.deepEqual(manifest.dsh.profile.bundles, [
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-web-app",
      "community-bundle",
      "@lares/dsh-overlay",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
