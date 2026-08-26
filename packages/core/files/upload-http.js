import { HttpError } from "../tools/http.js";
import { decodeUploadFilename, sanitizeFilename, UPLOAD_REQUEST_ID } from "./upload.js";

export function parseUploadHeaders(headers) {
  const sessionId = headers["x-lares-session-id"];
  const requestId = headers["x-lares-upload-request-id"];
  if (typeof requestId !== "string" || !UPLOAD_REQUEST_ID.test(requestId)) {
    throw new HttpError("upload_request_invalid", 400, "valid upload request id is required");
  }
  const filename = decodeUploadFilename(headers["x-lares-file-name"]);
  const mediaType = String(headers["content-type"] || "application/octet-stream").split(";", 1)[0];
  return { sessionId, requestId, filename, mediaType, name: sanitizeFilename(filename) };
}

export function uploadSuccessBody(stored, filename, mediaType) {
  return {
    path: stored.path,
    name: sanitizeFilename(filename),
    size: stored.size,
    mediaType,
  };
}
