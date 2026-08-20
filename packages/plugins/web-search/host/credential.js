import { WebError } from "@deepseek-ai/dsh-web";

/**
 * Header values are ByteStrings: a pasted key carrying CJK, whitespace or
 * control characters aborts fetch with an opaque TypeError instead of telling
 * the user their key is wrong. Every backend runs its key through here.
 */
const HEADER_SAFE = /^[\x21-\x7e]+$/;

/**
 * @param {string} key trimmed credential
 * @param {string} label provider name used in the message
 */
export function assertBearerKey(key, label) {
  if (!key) {
    throw new WebError(`${label} API key is required`, "WEB_PROVIDER_CREDENTIAL_MISSING");
  }
  if (!HEADER_SAFE.test(key)) {
    throw new WebError(
      `${label} API key contains characters that cannot be sent in an HTTP header`,
      "WEB_PROVIDER_CREDENTIAL_MISSING",
    );
  }
}
