/** Header the llm-gateway uses to resolve a caller's Olares app identity. */
export const OLARES_APP_ID_HEADER = "X-Olares-App-ID";

/** Path prefix the in-container shim serves; pi's models.json points here. */
export const GATEWAY_SHIM_PREFIX = "/llm/v1";

/** Provider id written into models.json for the gateway-backed provider. */
export const GATEWAY_PROVIDER_ID = "olares";

/**
 * Placeholder credential written into models.json. pi requires a non-empty
 * apiKey for openai-completions providers; the shim discards it.
 */
export const GATEWAY_PLACEHOLDER_API_KEY = "olares";

export const DEFAULT_PORT = 30141;
