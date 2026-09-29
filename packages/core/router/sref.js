import { createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Encrypted end-user credential for FlowStudio generations.
 *
 * Router forwards none of Lares' request headers to FlowStudio, so FlowStudio
 * only ever sees "the caller is Router". Router does carry request-body fields
 * it does not know into `params`, so the logged-in user rides there as an
 * encrypted `sref` and FlowStudio decrypts it (server/app/model_console/sref.py).
 * Both sides must stay byte-for-byte identical.
 *
 * Format: `1.<base64url(nonce[16] || ciphertext || tag[16])>`
 * - keys: SHA-256(SREF_KEY), split by HMAC into an encryption and a MAC key;
 * - cipher: keystream HMAC-SHA256(enc, nonce || counter) XOR plaintext;
 * - tag: HMAC-SHA256(mac, "sref/v1" || nonce || ciphertext) truncated to 16 bytes;
 * - plaintext: {"u": username, "t": unix seconds}; FlowStudio rejects it after 5 minutes.
 */
export const SREF_FIELD = "sref";
export const DEFAULT_SREF_KEY = "gBH4rLCE9by5QfqvIr9Jm2pFtJDxwE5kxlvaJ/0goeg=";

const NONCE_BYTES = 16;
const TAG_BYTES = 16;

function keys(secret) {
  const root = createHash("sha256").update(secret, "utf8").digest();
  return {
    enc: createHmac("sha256", root).update("sref/enc").digest(),
    mac: createHmac("sha256", root).update("sref/mac").digest(),
  };
}

function keystream(encKey, nonce, length) {
  const blocks = [];
  let size = 0;
  for (let counter = 0; size < length; counter += 1) {
    const index = Buffer.alloc(4);
    index.writeUInt32BE(counter);
    const block = createHmac("sha256", encKey).update(Buffer.concat([nonce, index])).digest();
    blocks.push(block);
    size += block.length;
  }
  return Buffer.concat(blocks).subarray(0, length);
}

/**
 * @param {string} user
 * @param {string} secret
 * @param {{ now?: number, nonce?: Buffer }} [options] now in milliseconds
 */
export function encodeSref(user, secret, options = {}) {
  const { enc, mac } = keys(secret);
  const issued = Math.floor((options.now ?? Date.now()) / 1000);
  const plain = Buffer.from(JSON.stringify({ u: user, t: issued }), "utf8");
  const nonce = options.nonce ?? randomBytes(NONCE_BYTES);
  const stream = keystream(enc, nonce, plain.length);
  const cipher = Buffer.alloc(plain.length);
  for (let i = 0; i < plain.length; i += 1) cipher[i] = plain[i] ^ stream[i];
  const tag = createHmac("sha256", mac)
    .update(Buffer.concat([Buffer.from("sref/v1"), nonce, cipher]))
    .digest()
    .subarray(0, TAG_BYTES);
  return `1.${Buffer.concat([nonce, cipher, tag]).toString("base64url")}`;
}

export function srefKey(env = process.env) {
  const configured = env.SREF_KEY;
  if (configured === undefined) return DEFAULT_SREF_KEY;
  return configured.trim();
}

/** A FlowStudio workflow in the Router catalog: `Olares/<workflow uuid>`. */
export function isFlowstudioModel(model) {
  return /^Olares\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(model ?? "").trim(),
  );
}

const CREATE_ROUTES = /^(images\/generations|images\/edits|videos|music\/generations|generations)\/?$/;

/** Whether a POST on this Router suffix creates a media generation. */
export function isGenerationCreateRoute(suffix) {
  return CREATE_ROUTES.test(String(suffix ?? "").replace(/^\/+/, ""));
}

/**
 * Stamp the encrypted user onto a FlowStudio generation request body.
 * Other providers, or no user / no key, get the body back untouched. A `sref`
 * the caller put there itself is always replaced, so it cannot name someone else.
 *
 * @param {Record<string, any>} body
 * @param {string} user
 */
export function withSref(body, user, env = process.env, options = {}) {
  if (body == null || typeof body !== "object" || Array.isArray(body)) return body;
  if (!isFlowstudioModel(body.model)) return body;
  const secret = srefKey(env);
  const name = String(user ?? "").trim();
  if (!secret || !name) return body;
  return { ...body, [SREF_FIELD]: encodeSref(name, secret, options) };
}

/** Same as `withSref` for a raw JSON request body; non-JSON is returned as is. */
export function withSrefBuffer(buffer, user, env = process.env, options = {}) {
  let parsed;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch {
    return buffer;
  }
  const stamped = withSref(parsed, user, env, options);
  return stamped === parsed ? buffer : Buffer.from(JSON.stringify(stamped), "utf8");
}
