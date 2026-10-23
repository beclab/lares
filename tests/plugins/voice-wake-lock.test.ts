import assert from "node:assert/strict";
import test from "node:test";
import { createScreenWakeLock } from "@olares/lares-core/voice/wake-lock";

function platform() {
  const listeners = new Map<string, Set<() => void>>();
  const requests: string[] = [];
  const locks: any[] = [];
  let released = 0;
  const sentinel = () => {
    const handlers = new Set<() => void>();
    return {
      released: false,
      release() {
        if (this.released) return;
        this.released = true; released += 1;
        for (const handler of handlers) handler();
      },
      addEventListener(type: string, handler: () => void) { if (type === "release") handlers.add(handler); },
    };
  };
  const doc: any = {
    visibilityState: "visible",
    addEventListener(type: string, listener: () => void) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    setVisibility(value: string) {
      doc.visibilityState = value;
      // A real platform withdraws the lock when the page is no longer visible.
      if (value === "hidden") for (const lock of locks) lock.release();
      for (const listener of listeners.get("visibilitychange") ?? []) listener();
    },
  };
  const nav: any = { wakeLock: { async request(kind: string) { requests.push(kind); const value = sentinel(); locks.push(value); return value; } } };
  return { nav, doc, requests, locks, get released() { return released; } };
}

test("a readout holds the screen and drops it when the answer ends", async () => {
  const p = platform();
  const wake = createScreenWakeLock(p.nav, p.doc);
  try {
    assert.equal(await wake.hold(), true);
    assert.equal(wake.held, true);
    assert.deepEqual(p.requests, ["screen"]);
    wake.release();
    assert.equal(wake.held, false);
    assert.equal(p.released, 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(wake.held, false);
  } finally { wake.release(); }
});

test("a hidden page takes its lock back when it returns", async () => {
  const p = platform();
  const wake = createScreenWakeLock(p.nav, p.doc);
  try {
    await wake.hold();
    p.doc.setVisibility("hidden");
    assert.equal(wake.held, false);
    p.doc.setVisibility("visible");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(p.requests.length, 2);
    assert.equal(wake.held, true);
  } finally { wake.release(); }
});

test("a WebView without the API leaves playback alone", async () => {
  const wake = createScreenWakeLock({}, { visibilityState: "visible", addEventListener() {} });
  assert.equal(wake.supported, false);
  assert.equal(await wake.hold(), false);
  assert.equal(wake.held, false);
  wake.release();
});

test("a lock released by the platform can be asked for again", async () => {
  const p = platform();
  const wake = createScreenWakeLock(p.nav, p.doc);
  try {
    await wake.hold();
    p.locks[0].release();
    assert.equal(wake.held, false);
    await wake.hold();
    assert.equal(p.requests.length, 2);
  } finally { wake.release(); }
});
