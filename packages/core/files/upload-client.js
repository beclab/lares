const UPLOAD_TIMEOUT_MS = 120_000;
export const FILES_UPLOAD_PATH = "/api/lares/files/upload";

function errorCode(payload) {
  return payload && typeof payload === "object" && payload.error && typeof payload.error.code === "string"
    ? payload.error.code
    : "file_upload_failed";
}

/**
 * `fetch` can only authenticate with the Olares cookie, and a host whose page is
 * cross-origin to the Host — a packaged LarePass desktop build is a `file://`
 * page — has none, so the upload answers 401 while every RPC call succeeds.
 * When the host injects a `request` port the upload rides the same auth as the
 * rest of the client; without one this stays the plain cookie fetch.
 */
async function postUpload(options, url, headers, body, signal) {
  if (typeof options.request === "function") {
    const res = await options.request(url, { method: "POST", headers, body, signal });
    return {
      ok: Boolean(res?.ok),
      status: Number(res?.status) || 0,
      // The port already parsed the body; an empty one arrives as undefined.
      payload: res?.body ?? null,
    };
  }
  const res = await fetch(url, { method: "POST", headers, body, signal });
  return {
    ok: res.ok,
    status: res.status,
    payload: await res.json().catch(() => null),
  };
}

export async function uploadFile(file, sessionId, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  const onAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) controller.abort(options.signal.reason);
  else options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const { ok, status, payload } = await postUpload(
      options,
      options.url ?? FILES_UPLOAD_PATH,
      {
        "content-type": file.type || "application/octet-stream",
        "x-lares-file-name": encodeURIComponent(file.name || "file"),
        "x-lares-session-id": sessionId,
        "x-lares-upload-request-id": options.requestId ?? crypto.randomUUID(),
      },
      file,
      controller.signal,
    );
    if (!ok) {
      const error = new Error(errorCode(payload));
      error.status = status;
      throw error;
    }
    if (!payload || typeof payload.path !== "string") throw new Error("file_upload_failed");
    return payload;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
