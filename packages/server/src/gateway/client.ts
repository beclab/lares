export interface GatewayAuth {
	baseUrl: string;
	appId: string | null;
	apiKey: string | null;
}

/**
 * Build the credential headers for a gateway call.
 *
 * A user api key is sent as a bearer token. Every other case (app identity or
 * nothing configured) sends no credential header at all; the gateway resolves
 * the caller without X-Olares-App-ID.
 */
export function authHeaders(auth: GatewayAuth): Record<string, string> {
	if (auth.apiKey) return { authorization: `Bearer ${auth.apiKey}` };
	// Non-bearer calls no longer send X-Olares-App-ID; the gateway resolves the
	// caller's app identity without it. Bearer stays the only credential header.
	return {};
}

export function describeAuth(auth: GatewayAuth): string {
	if (auth.apiKey) return "user api key";
	if (auth.appId) return `olares app identity (${auth.appId})`;
	return "none configured";
}

/**
 * Explain a gateway rejection in terms the user can act on. The gateway's own
 * message ("invalid api key") is accurate but says nothing about which of the
 * two auth schemes lares is using.
 */
export function authFailureHint(auth: GatewayAuth): string {
	if (auth.apiKey) {
		return "LARES_GATEWAY_API_KEY was rejected. Create a new key in Olares Settings and restart the app.";
	}
	if (auth.appId) {
		return `The gateway rejected the app identity "${auth.appId}". Check that the app is registered and not suspended in the LLM Gateway console.`;
	}
	return "No gateway credentials are configured. Set OLARES_APP_ID, or LARES_GATEWAY_API_KEY for a user key.";
}
