export function posixBasename(path) {
  const raw = String(path ?? "");
  const trimmed = raw.replace(/\/+$/, "");
  if (trimmed === "") return raw.includes("/") ? "/" : "";
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

export function posixExtname(path) {
  const base = posixBasename(path);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

export function sanitizeFilename(value) {
  const source = posixBasename(String(value || "file")).normalize("NFC");
  const safe = source
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 160);
  return safe || "file";
}
