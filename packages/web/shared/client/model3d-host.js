/**
 * Seat for a 3D mesh inside workspace-preview chrome.
 * The preview plugin mounts an empty host; workspace-preview-3d attaches Three.js.
 *
 * Both client plugins are bundled separately, so this module cannot keep the
 * registry in module scope — each bundle would get its own Map. The seat lives
 * on globalThis so attach and subscribe share one live set.
 */
const KEY = "__laresModel3dHostSeat__";

function seat() {
  const root = globalThis;
  if (!root[KEY]) root[KEY] = { live: new Map(), listeners: new Set() };
  return root[KEY];
}

export function attachedModel3dHosts() {
  return [...seat().live.keys()];
}

export function subscribeModel3dHost(listener) {
  const { live, listeners } = seat();
  listeners.add(listener);
  for (const [node, props] of live) listener({ type: "attach", node, ...props });
  return () => listeners.delete(listener);
}

export function attachModel3dHost(node, props) {
  if (!node) return () => {};
  const { live, listeners } = seat();
  live.set(node, props);
  for (const listener of listeners) listener({ type: "attach", node, ...props });
  return () => {
    live.delete(node);
    for (const listener of listeners) listener({ type: "detach", node });
  };
}
