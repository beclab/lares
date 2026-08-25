const FRAME_NAME = "lares-file-preview-download";

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

function saveThroughFrame(url) {
  let frame = document.querySelector(`iframe[name="${FRAME_NAME}"]`);
  if (frame === null) {
    frame = document.createElement("iframe");
    frame.name = FRAME_NAME;
    frame.hidden = true;
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("sandbox", "allow-downloads");
    document.body.append(frame);
  }
  frame.src = url;
}

/**
 * HEAD keeps failures observable without buffering the file. The GET then runs
 * in an invisible frame: attachment responses stream to disk, while a deletion
 * racing the preflight can only replace that frame, never the conversation.
 */
export async function downloadCurrentFile(url, { fetchFn = fetch, save = saveThroughFrame } = {}) {
  const response = await fetchFn(url, { method: "HEAD" });
  if (!response.ok) {
    throw new Error(response.status === 404 ? "file_not_found" : "file_preview_failed");
  }
  save(url, filenameFromDisposition(response.headers.get("content-disposition")));
}
