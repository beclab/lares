/**
 * Router's local engines decode prompt images with llama.cpp's stb_image,
 * which has no WebP decoder: a WebP part is dropped from the prompt without an
 * error and the model answers as though no image arrived. dsh sends each image
 * in the media type it was uploaded as, so this gateway — the one hop every
 * image bound for Router takes, whatever composer or tool produced it — is
 * where the encoding is brought back into what the engines read.
 */
import sharp from "sharp";

const WEBP_DATA_URL = /^data:image\/webp;base64,([a-z0-9+/=\s]*)$/i;
/** Parsing a chat body is only worth it when one of these is actually in it. */
const WEBP_MARKER = "data:image/webp";

/** @param {Buffer} body */
export function carriesWebpImage(body) {
  return body.includes(WEBP_MARKER);
}

/**
 * PNG preserves an icon's transparency; a photograph re-encoded losslessly
 * would multiply the request body, so one without alpha goes to JPEG.
 */
async function transcode(dataUrl) {
  const match = WEBP_DATA_URL.exec(dataUrl);
  if (match === null) return dataUrl;
  const image = sharp(Buffer.from(match[1], "base64"));
  const { hasAlpha } = await image.metadata();
  const mediaType = hasAlpha ? "image/png" : "image/jpeg";
  const bytes = await (hasAlpha ? image.png() : image.jpeg({ quality: 90 })).toBuffer();
  return `data:${mediaType};base64,${bytes.toString("base64")}`;
}

/**
 * Re-encode every WebP data URL the payload carries, wherever it sits: the
 * OpenAI wire shape puts one under `image_url.url`, but a nested tool result
 * or a future part spells its own path to the same string.
 */
async function rewrite(value) {
  if (typeof value === "string") return transcode(value);
  if (Array.isArray(value)) return Promise.all(value.map((item) => rewrite(item)));
  if (value === null || typeof value !== "object") return value;
  const entries = await Promise.all(
    Object.entries(value).map(async ([key, nested]) => [key, await rewrite(nested)]),
  );
  return Object.fromEntries(entries);
}

/**
 * @param {Buffer} body - the chat request exactly as dsh sent it.
 * @returns {Promise<Buffer>} the same request with WebP images re-encoded as
 * PNG, or the original bytes when it cannot be rewritten.
 */
export async function transcodeWebpImages(body) {
  try {
    const rewritten = await rewrite(JSON.parse(body.toString("utf8")));
    return Buffer.from(JSON.stringify(rewritten), "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[lares] WebP prompt image forwarded unconverted: ${message}`);
    return body;
  }
}
