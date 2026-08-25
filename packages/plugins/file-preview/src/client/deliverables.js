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
