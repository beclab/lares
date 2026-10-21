import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { parse, compileScript, compileTemplate } from "@vue/compiler-sfc";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { defaultDictationProfiles } from "@olares/lares-core/voice/dictation";
import { createHostSettings, resetHostSettingsCache } from "@olares/lares-core/larepass/settings";

const require = createRequire(import.meta.url);
async function component(entry: string) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "cjs", external: ["vue", "vue/server-renderer"], plugins: [{ name: "vue-settings-tests", setup(builder) {
    builder.onResolve({ filter: /^@olares\/lares-core\// }, args => ({ path: resolve("packages/core", `${args.path.slice("@olares/lares-core/".length)}.js`) }));
    builder.onLoad({ filter: /\.vue$/ }, args => {
      const { descriptor } = parse(readFileSync(args.path, "utf8"));
      const script = compileScript(descriptor, { id: "settings-test", genDefaultAs: "__component" });
      const template = compileTemplate({ source: descriptor.template!.content, filename: args.path, id: "settings-test", ssr: true, ssrCssVars: descriptor.cssVars, compilerOptions: { bindingMetadata: script.bindings } });
      if (template.errors.length) throw template.errors[0];
      return { contents: `${script.content}\n${template.code}\n__component.ssrRender = ssrRender; export default __component;`, loader: "js", resolveDir: dirname(args.path) };
    });
  } }] });
  const module = { exports: {} as any }; new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports); return module.exports.default;
}

test("real Vue preferences renders one selected preset and expanded configuration; shortcuts require explicit desktop", async () => {
  const Component = await component("packages/mobile/src/settings/VoicePreferences.vue");
  const snapshot = { config: { dictationPreset: "clean", dictationProfiles: defaultDictationProfiles(), dictationShortcuts: { default: "", raw: "", clean: "", outline: "", summary: "" } }, chatModels: ["chat"] };
  for (const device of ["desktop", "mobile", "tablet"]) {
    const html = await renderToString(createSSRApp(Component, { settings: {}, ttsFetch: async () => Response.json({ voices: [] }), snapshot, device, t: (key: string) => key }));
    assert.ok(html.includes("dictation.clean"));
    assert.equal(html.includes("<select"), false);
    assert.equal(html.includes("<details"), false); assert.equal(html.includes("preferences.shortcuts"), device === "desktop");
    assert.ok(html.includes('rows="6"')); assert.ok(html.includes("preferences.dictationStyle"));
    assert.equal(html.includes("preferences.setDefault"), false); assert.equal(html.includes("preferences.editing"), false);
    assert.equal(html.includes("aria-pressed"), false);
    assert.equal(html.includes("settings.preset"), false); assert.equal(html.includes("settings.backend"), false);
  }
  const html = await renderToString(createSSRApp(Component, { settings: {}, ttsFetch: async () => Response.json({ voices: [] }), snapshot: { ...snapshot, config: { ...snapshot.config, dictationPreset: "raw" } }, device: "mobile", t: (key: string) => key }));
  assert.ok(html.includes("dictation.noLlm")); assert.equal(html.includes("<textarea"), false); assert.equal(html.includes("dictation.model"), false);
});

test("Vue settings SDK lightweight path and save avoid diagnostics and preserve API-only fields", async () => {
  resetHostSettingsCache(); const paths: string[] = [];
  let config = { preset: "assistant", backend: "realtime", chatModel: "separate", dictationPreset: "clean" };
  const settings = createHostSettings(async (path: string, options: any = {}) => {
    paths.push(path);
    if (options.method === "POST") { config = { ...config, ...options.body }; return { ok: true, body: config }; }
    if (path.endsWith("/config")) return { ok: true, body: config };
    if (path.includes("/capabilities")) return { ok: true, body: { selected: "asr", stt: ["asr"], tts: ["tts"] } };
    assert.fail(`Unexpected diagnostics: ${path}`);
  });
  await settings.voice(false, { diagnostics: false }); await settings.saveVoice({ dictationPreset: "raw" }, { diagnostics: false });
  assert.deepEqual(paths, ["/api/lares/voice/config", "/api/lares/voice/capabilities", "/api/lares/voice/config"]);
  assert.equal(config.preset, "assistant"); assert.equal(config.backend, "realtime"); assert.equal(config.chatModel, "separate");
});

test("Vue voice keys lists keys, leaves Agent models unchecked and warns when they are chosen", async () => {
  const Component = await component("packages/mobile/src/settings/VoiceKeys.vue");
  const client = { list: async () => [], issue: async () => ({}), revoke: async () => true };
  const html = await renderToString(createSSRApp(Component, { client, t: (key: string) => key }));
  assert.ok(html.includes("settings.group.keys")); assert.ok(html.includes("settings.keys.issue"));
  for (const model of ["voice-dictation", "voice-chat", "voice-assistant", "voice-direct"]) assert.ok(html.includes(model));
  assert.equal((html.match(/checked/g) || []).length, 2);
  assert.equal(html.includes("settings.keys.agentWarning"), false);
});
