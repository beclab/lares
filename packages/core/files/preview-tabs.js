/**
 * Tab-strip rules for workspace file previews. The dsh web overlay and the
 * LarePass PC shell fetch through different transports but must open, evict and
 * close tabs the same way, so the rules live here and each surface keeps only
 * its own content cache.
 */
import { fileName } from "./filename.js";

export const MAX_PREVIEW_TABS = 8;

/** Least-recently-used order, oldest first. */
export function touchTab(lru, path) {
  return [...lru.filter((item) => item !== path), path];
}

/**
 * @returns tabs, the new LRU order, and the tab an over-full strip dropped so
 * the caller can release whatever it cached for it.
 */
export function openTab({ tabs, lru }, path) {
  if (tabs.some((tab) => tab.path === path)) {
    return { tabs, lru: touchTab(lru, path), evicted: null };
  }
  let kept = tabs;
  let evicted = null;
  if (kept.length >= MAX_PREVIEW_TABS) {
    evicted = kept.find((tab) => tab.path === lru[0]) ?? kept[0];
    kept = kept.filter((tab) => tab.path !== evicted.path);
  }
  return {
    tabs: [...kept, { path, name: fileName(path) }],
    lru: touchTab(evicted ? lru.filter((item) => item !== evicted.path) : lru, path),
    evicted,
  };
}

/**
 * @returns null when the path owns no tab, otherwise the strip without it. The
 * reader lands on the tab they read last; an empty strip reports no active path.
 */
export function closeTab({ tabs, lru, activePath }, path) {
  if (!tabs.some((tab) => tab.path === path)) return null;
  const kept = tabs.filter((tab) => tab.path !== path);
  const order = lru.filter((item) => item !== path);
  if (kept.length === 0) return { tabs: kept, lru: order, activePath: null };
  return {
    tabs: kept,
    lru: order,
    activePath: activePath === path ? order.at(-1) ?? kept.at(-1).path : activePath,
  };
}
