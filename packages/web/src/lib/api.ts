import type {
	AgentCommand,
	GatewayStatus,
	LaresEvent,
	ModelsResponse,
	SessionListResponse,
	SessionState,
	SessionSummary,
} from "@lares/shared";

export interface AppConfig {
	workspace: string;
	agentDir: string;
	gateway: { baseUrl: string; auth: string };
}

export interface SessionDetail {
	session: SessionSummary;
	entries: unknown[];
	leafId: string | null;
}

export class ApiError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(path, {
		...init,
		headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
	});
	const text = await response.text();
	const payload = text ? (JSON.parse(text) as unknown) : null;

	if (!response.ok) {
		const message =
			payload && typeof payload === "object" && "error" in payload
				? String((payload as { error: unknown }).error)
				: `Request failed with ${response.status}`;
		throw new ApiError(response.status, message);
	}
	return payload as T;
}

interface CommandEnvelope<T> {
	success: boolean;
	data: T;
	sessionId?: string;
	error?: string;
}

export const api = {
	config: () => request<AppConfig>("/api/config"),

	listSessions: () => request<SessionListResponse>("/api/sessions"),

	getSession: (id: string) => request<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`),

	models: () => request<ModelsResponse>("/api/models"),

	gatewayStatus: () => request<GatewayStatus>("/api/gateway/status"),

	syncGatewayModels: () =>
		request<{ discovered: string[]; added: string[]; kept: string[] }>("/api/gateway/sync-models", {
			method: "POST",
		}),

	async createSession(cwd: string, command: AgentCommand): Promise<string> {
		const result = await request<CommandEnvelope<unknown>>("/api/agent/new", {
			method: "POST",
			body: JSON.stringify({ cwd, command }),
		});
		if (!result.sessionId) throw new ApiError(500, "Server did not return a session id");
		return result.sessionId;
	},

	async send<T = unknown>(sessionId: string, command: AgentCommand): Promise<T> {
		const result = await request<CommandEnvelope<T>>(`/api/agent/${encodeURIComponent(sessionId)}`, {
			method: "POST",
			body: JSON.stringify(command),
		});
		return result.data;
	},

	getState: (sessionId: string) => api.send<SessionState>(sessionId, { type: "get_state" }),
};

/**
 * Subscribe to a session's event stream. The returned function closes it.
 *
 * EventSource reconnects on its own; callers re-sync state on `connected`
 * rather than relying on replayed events, because the server does not buffer.
 */
export function subscribeToSession(
	sessionId: string,
	onEvent: (event: LaresEvent) => void,
	onError?: (error: Event) => void,
): () => void {
	const source = new EventSource(`/api/agent/${encodeURIComponent(sessionId)}/events`);
	source.onmessage = (message) => {
		if (!message.data) return;
		onEvent(JSON.parse(message.data) as LaresEvent);
	};
	if (onError) source.onerror = onError;
	return () => source.close();
}
