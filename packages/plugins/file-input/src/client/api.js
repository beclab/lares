const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const UPLOAD_TIMEOUT_MS = 120_000;

function errorCode(payload) {
  return payload && typeof payload === "object" && payload.error && typeof payload.error.code === "string"
    ? payload.error.code
    : "file_upload_failed";
}

async function uploadAttempt(file, sessionId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const response = await fetch("/api/lares/files/upload", {
      method: "POST",
      headers: {
        "content-type": file.type || "application/octet-stream",
        "x-lares-file-name": encodeURIComponent(file.name || "file"),
        "x-lares-session-id": sessionId,
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
  }
}

/**
 * A retry writes a second copy under a numbered name when the first attempt
 * stored the file but its response never arrived — the cost of naming uploads
 * after the file rather than after an upload id.
 */
export async function uploadFile(file, sessionId) {
  try {
    return await uploadAttempt(file, sessionId);
  } catch (error) {
    if (error?.name !== "AbortError" && !RETRYABLE_STATUS.has(error?.status)) throw error;
    return uploadAttempt(file, sessionId);
  }
}
