/**
 * A phone that turns its screen off suspends the WebView: the AudioContext is
 * interrupted and the socket is torn down, so a long answer stops after the
 * first sentences. Keeping the screen awake for the length of a readout is the
 * only part of that chain the page itself can control.
 *
 * The lock is only a hint. A WebView without `navigator.wakeLock`, or a request
 * the platform refuses (no gesture, low power mode), must leave playback alone.
 */
export function createScreenWakeLock(nav = globalThis.navigator, doc = globalThis.document) {
  let sentinel = null;
  let wanted = false;
  let watching = false;
  const supported = () => typeof nav?.wakeLock?.request === "function";

  const drop = () => {
    const held = sentinel;
    sentinel = null;
    if (!held) return;
    try { void held.release?.()?.catch?.(() => {}); } catch { /* already released */ }
  };

  const acquire = async () => {
    if (!wanted || sentinel || !supported() || doc?.visibilityState === "hidden") return false;
    try {
      const held = await nav.wakeLock.request("screen");
      // The answer may have ended while the platform was answering the request.
      if (!wanted) { try { void held.release?.()?.catch?.(() => {}); } catch { /* already released */ } return false; }
      sentinel = held;
      held.addEventListener?.("release", () => { if (sentinel === held) sentinel = null; });
      return true;
    } catch {
      return false;
    }
  };

  // A hidden page loses its lock. Re-acquire through the platform's own rule
  // instead of guessing when the page is allowed to hold one again.
  const watch = () => {
    if (watching || !doc?.addEventListener) return;
    watching = true;
    doc.addEventListener("visibilitychange", () => { if (wanted && doc.visibilityState === "visible") void acquire(); });
  };

  return {
    get supported() { return supported(); },
    get held() { return Boolean(sentinel); },
    /** Ask for the lock; resolves to whether the platform granted it. */
    async hold() { wanted = true; watch(); return acquire(); },
    release() { wanted = false; drop(); },
  };
}
