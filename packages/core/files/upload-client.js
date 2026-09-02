const UPLOAD_TIMEOUT_MS = 120_000;
export const FILES_UPLOAD_PATH = "/api/lares/files/upload";

function errorCode(payload) {
  return payload && typeof payload === "object" && payload.error && typeof payload.error.code === "string"
    ? payload.error.code
    : "file_upload_failed";
}

export async function uploadFile(file, sessionId, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  const onAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) controller.abort(options.signal.reason);
  else options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(options.url ?? FILES_UPLOAD_PATH, {
      method: "POST",
      headers: {
        "content-type": file.type || "application/octet-stream",
        "x-lares-file-name": encodeURIComponent(file.name || "file"),
        "x-lares-session-id": sessionId,
        "x-lares-upload-request-id": options.requestId ?? crypto.randomUUID(),
      },
      body: file,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(errorCode(payload));
      error.status = response.status;
      throw error;
    }
    if (!payload || typeof payload.path !== "string") throw new Error("file_upload_failed");
    return payload;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
