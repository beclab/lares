import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const flush = () => new Promise(resolve => setImmediate(resolve));
function shell() {
  const source = readFileSync(new URL("../../node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js", import.meta.url), "utf8");
  const start = source.indexOf("function SettingsPanel("); const end = source.indexOf("\n\t\t/**", start);
  let owner: any, modalClose: any; const selected: string[] = []; let closes = 0;
  const tree = new Function("react", "_deepseek_ai_dsh_client_ui_primitives", "react_dom", "react_jsx_runtime", "SettingsRoot_module_css_default", "navIcon", "clsx", `${source.slice(start, end)}; return SettingsPanel;`)(
    { useRef: (current: any) => ({ current }), useCallback: (fn: any) => fn, useId: () => "title" },
    { useModalLayer: (_ref: any, _open: any, close: any) => { modalClose = close; } }, { createPortal: (tree: any) => tree },
    { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) }, new Proxy({}, { get: (_target, key) => key }), () => null, (...args: any[]) => args.filter(Boolean).join(" "),
  )({ rows: [{ id: "voice" }, { id: "other" }], activeId: "voice", renderSlot: (id: string, props: any) => { if (id === "settings.section") owner = props; return null; }, onClose: () => { closes++; }, onSelect: (id: string) => selected.push(id) });
  function all(node: any): any[] { if (!node || typeof node !== "object") return []; return [node, ...[node.props?.children].flat(Infinity).flatMap(all)]; }
  const nodes = all(tree);
  return { owner, selected, get closes() { return closes; }, modalClose: () => modalClose(), closeButton: () => nodes.find(node => node.type === "button" && node.props.className === "close").props.onClick(),
    select: () => nodes.find(node => node.type === "button" && node.props.className === "navCell").props.onClick() };
}

test("official settings close, mask/Esc callback and section changes all respect a leave veto", async () => {
  const original = (globalThis as any).document; (globalThis as any).document = { body: {} };
  try {
    for (const action of ["closeButton", "modalClose", "select"] as const) {
      const h = shell(); const off = h.owner.bindBeforeLeave(() => false); h[action](); await flush();
      assert.equal(h.closes, 0); assert.deepEqual(h.selected, []); off(); h[action](); await flush();
      assert.equal(action === "select" ? h.selected.length : h.closes, 1);
    }
  } finally { (globalThis as any).document = original; }
});

test("pending leave save is awaited once, and rejection keeps settings open", async () => {
  const original = (globalThis as any).document; (globalThis as any).document = { body: {} };
  try {
    const h = shell(); let release!: (value: boolean) => void, prompts = 0;
    const off = h.owner.bindBeforeLeave(() => { prompts++; return new Promise(done => { release = done; }); });
    h.select(); h.closeButton(); h.modalClose(); assert.equal(prompts, 1); assert.deepEqual(h.selected, []);
    release(true); await flush(); assert.deepEqual(h.selected, ["other"]); assert.equal(h.closes, 0);
    off(); h.owner.bindBeforeLeave(async () => false); h.closeButton(); await flush(); assert.equal(h.closes, 0);
  } finally { (globalThis as any).document = original; }
});

test("document capture shortcut handler yields to a focused shortcut recorder before Escape or dictation", async () => {
  const source = readFileSync(new URL("../../packages/web/composer-voice/src/client/MicButton.js", import.meta.url), "utf8");
  const start = source.indexOf("const keydown = event => {"); const end = source.indexOf("\n    refresh();", start);
  const handler = new Function("panel", `${source.slice(start, end)}; return keydown;`)({ getSnapshot: () => assert.fail("recording shortcut must not touch active voice") });
  for (const key of ["Escape", "1"]) handler({ key, ctrlKey: true, shiftKey: true, composedPath: () => [{ hasAttribute: (name: string) => name === "data-voice-shortcut-recorder" }] });
});
