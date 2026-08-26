const REFERENCE_SOURCE = "reference";

export function mentionOf(path) {
  return /[\s"]/u.test(path) ? `@"${path}"` : `@${path}`;
}

export function uploadReference(path) {
  const ref = mentionOf(path);
  return {
    source: REFERENCE_SOURCE,
    ref,
    label: path.slice(path.lastIndexOf("/") + 1),
    appearance: "file",
    clipboardText: ref,
  };
}
