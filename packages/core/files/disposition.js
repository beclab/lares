export function filenameFromDisposition(value) {
  const encoded = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(String(value ?? ""));
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim().replace(/^"(.*)"$/s, "$1"));
    } catch {
      // Fall through to the ASCII filename, or the generic save name.
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(String(value ?? ""));
  return plain?.[1]?.trim() ?? "";
}

export async function preflightDownload(url, fetchFn = fetch) {
  const response = await fetchFn(url, { method: "HEAD" });
  if (!response.ok) {
    throw new Error(response.status === 404 ? "file_not_found" : "file_preview_failed");
  }
  return filenameFromDisposition(response.headers.get("content-disposition"));
}
