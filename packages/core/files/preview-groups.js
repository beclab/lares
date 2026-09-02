const MEDIA_KINDS = new Set(["image", "video", "audio", "model3d"]);

export function partitionPreviews(paths, previews) {
  const media = [];
  const files = [];
  const seen = new Set();
  let loading = false;
  for (const original of paths) {
    if (!previews.has(original)) {
      loading = true;
      continue;
    }
    const preview = previews.get(original);
    const path = preview?.path ?? original;
    if (seen.has(path)) continue;
    seen.add(path);
    if (preview !== null && MEDIA_KINDS.has(preview.kind)) media.push(preview);
    else files.push(path);
  }
  return { media, files, loading };
}
