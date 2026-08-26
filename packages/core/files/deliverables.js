/** Same rule as dsh-client-ui-deliverables: only edit/diff call views produce files. */
export function producedPathsFromView(view) {
  if (!view || !Array.isArray(view.locations)) return [];
  const writable = view.card === "diff" || (view.card === "generic" && view.kind === "edit");
  if (!writable) return [];
  const paths = [];
  const seen = new Set();
  for (const location of view.locations) {
    const path = location?.path;
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

export function producedForClosing(owner) {
  const produced = owner.turn.data.get("deliverables")?.produced ?? [];
  const paths = [];
  const seen = new Set();
  for (const item of produced) {
    if (item.seq > owner.seq || seen.has(item.path)) continue;
    seen.add(item.path);
    paths.push(item.path);
  }
  return paths;
}

export function selectProducedFiles(owner) {
  const paths = producedForClosing(owner);
  return paths.length === 0 ? null : paths;
}
