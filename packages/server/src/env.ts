import { resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { DEFAULT_PORT } from "@lares/shared";

export interface LaresEnv {
	port: number;
	host: string;
	/** pi's config root. Also exported back into process.env so pi picks it up. */
	agentDir: string;
	/** Default working directory offered to new sessions. */
	workspace: string;
	gatewayUrl: string;
	/** Value sent as X-Olares-App-ID when no bearer key is configured. */
	olaresAppId: string | null;
	/** When set, the shim authenticates as a user instead of as an app. */
	gatewayApiKey: string | null;
	/** `provider/id` written into settings.json when no default model is set yet. */
	defaultModel: string | null;
	/** Directory holding the built SPA. Absent during API-only development. */
	webRoot: string | null;
}

function readNumber(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (Number.isNaN(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
	}
	return parsed;
}

function readString(name: string): string | null {
	const raw = process.env[name]?.trim();
	return raw ? raw : null;
}

export function loadEnv(): LaresEnv {
	const agentDir = readString("PI_CODING_AGENT_DIR") ?? getAgentDir();

	// pi resolves its own paths from this variable, so normalise it once here
	// and write it back before any pi API is touched.
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.PI_SKIP_VERSION_CHECK ??= "1";

	return {
		port: readNumber("PORT", DEFAULT_PORT),
		host: readString("HOST") ?? "0.0.0.0",
		agentDir,
		workspace: resolve(readString("LARES_WORKSPACE") ?? process.cwd()),
		gatewayUrl: (readString("LLM_GATEWAY_URL") ?? "http://llm-gateway-backend.os-framework:8080/v1").replace(
			/\/+$/,
			"",
		),
		olaresAppId: readString("OLARES_APP_ID"),
		gatewayApiKey: readString("LARES_GATEWAY_API_KEY"),
		defaultModel: readString("PI_DEFAULT_MODEL"),
		webRoot: readString("LARES_WEB_ROOT"),
	};
}
