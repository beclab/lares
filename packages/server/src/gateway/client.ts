import { OLARES_APP_ID_HEADER } from "@lares/shared";

export interface GatewayAuth {
	baseUrl: string;
	appId: string | null;
	apiKey: string | null;
}

/**
 * Build the credential headers for a gateway call.
 *
 * The gateway's data plane treats a present Authorization header as an
 * exclusive claim to user identity, so the two schemes must never be mixed:
 * either a bearer key, or the app id header alone.
 */
export function authHeaders(auth: GatewayAuth): Record<string, string> {
	if (auth.apiKey) return { authorization: `Bearer ${auth.apiKey}` };
	if (auth.appId) return { [OLARES_APP_ID_HEADER]: auth.appId };
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
