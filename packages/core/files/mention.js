function mentionOf(path) {
  return /[\s"]/u.test(path) ? `@"${path}"` : `@${path}`;
}

export function appendDraftMentions(draft, paths) {
  let next = String(draft ?? "");
  for (const path of Array.isArray(paths) ? paths : []) {
    if (!path) continue;
    const ref = mentionOf(path);
    if (next && !/\s$/u.test(next)) next += " ";
    next += ref;
  }
  return next;
}
