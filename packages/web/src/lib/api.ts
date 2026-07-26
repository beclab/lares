import type {
	AgentCommand,
	DirListing,
	EditableSettings,
	FileContent,
	FileIndexResponse,
	FileMeta,
	ForkResponse,
	GatewayStatus,
	GitDiffResponse,
	GitStatusResponse,
	LaresEvent,
	ModelsResponse,
	PluginsResponse,
	ProviderAuthInfo,
	SessionListResponse,
	SessionState,
	SessionSummary,
	SessionTreeResponse,
	SettingsResponse,
	SkillsResponse,
	WorktreeInfo,
	WorktreeListResponse,
} from "@lares/shared";

export interface AppConfig {
	workspace: string;
	agentDir: string;
	gateway: { baseUrl: string; auth: string };
}

/** "at" keeps the chosen entry; "before" drops it so the prompt can be rewritten. */
export type ForkMode = "at" | "before";

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

	getSessionTree: (id: string) => request<SessionTreeResponse>(`/api/sessions/${encodeURIComponent(id)}/tree`),

	renameSession: (id: string, name: string) =>
		request<{ name: string }>(`/api/sessions/${encodeURIComponent(id)}/name`, {
			method: "POST",
			body: JSON.stringify({ name }),
		}),

	deleteSession: (id: string) =>
		request<{ deleted: string }>(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),

	forkSession: (id: string, entryId?: string, mode?: ForkMode) =>
		request<ForkResponse>(`/api/sessions/${encodeURIComponent(id)}/fork`, {
			method: "POST",
			body: JSON.stringify({ ...(entryId ? { entryId } : {}), ...(mode ? { mode } : {}) }),
		}),

	exportUrl: (id: string, format: "html" | "jsonl") =>
		`/api/sessions/${encodeURIComponent(id)}/export?format=${format}`,

	listFiles: (path?: string) =>
		request<DirListing>(`/api/files/list${path ? `?path=${encodeURIComponent(path)}` : ""}`),

	readFile: (path: string) => request<FileContent>(`/api/files/read?path=${encodeURIComponent(path)}`),

	fileMeta: (path: string) => request<FileMeta>(`/api/files/meta?path=${encodeURIComponent(path)}`),

	docxHtml: (path: string) => request<{ html: string }>(`/api/files/docx?path=${encodeURIComponent(path)}`),

	rawUrl: (path: string, download = false) =>
		`/api/files/raw?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`,

	fileIndex: (query: string, cwd?: string) => {
		const params = new URLSearchParams({ q: query });
		if (cwd) params.set("cwd", cwd);
		return request<FileIndexResponse>(`/api/files/index?${params.toString()}`);
	},

	worktrees: (cwd?: string) =>
		request<WorktreeListResponse>(`/api/worktrees${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`),

	addWorktree: (cwd: string, branch: string, startPoint?: string) =>
		request<WorktreeInfo>("/api/worktrees", {
			method: "POST",
			body: JSON.stringify({ cwd, branch, ...(startPoint ? { startPoint } : {}) }),
		}),

	removeWorktree: (path: string, force = false) =>
		request<{ removed: string }>("/api/worktrees", {
			method: "DELETE",
			body: JSON.stringify({ path, force }),
		}),

	gitStatus: (cwd?: string) =>
		request<GitStatusResponse>(`/api/git/status${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`),

	gitDiff: (path: string, cwd?: string) => {
		const params = new URLSearchParams({ path });
		if (cwd) params.set("cwd", cwd);
		return request<GitDiffResponse>(`/api/git/diff?${params.toString()}`);
	},

	models: () => request<ModelsResponse>("/api/models"),

	refreshModels: () =>
		request<{ providers: string[]; error: string | null }>("/api/models/refresh", { method: "POST" }),

	modelsConfig: () => request<{ config: unknown }>("/api/models/config"),

	saveModelsConfig: (config: unknown) =>
		request<{ config: unknown; error: string | null; dropped: string[] }>("/api/models/config", {
			method: "PUT",
			body: JSON.stringify({ config }),
		}),

	settings: () => request<SettingsResponse>("/api/settings"),

	saveSettings: (patch: Partial<EditableSettings>) =>
		request<{ settings: EditableSettings }>("/api/settings", { method: "PATCH", body: JSON.stringify(patch) }),

	authProviders: () => request<{ providers: ProviderAuthInfo[] }>("/api/auth/providers"),

	setApiKey: (provider: string, apiKey: string) =>
		request<{ configured: boolean }>(`/api/auth/api-key/${encodeURIComponent(provider)}`, {
			method: "POST",
			body: JSON.stringify({ apiKey }),
		}),

	signOut: (provider: string) =>
		request<{ configured: boolean }>(`/api/auth/${encodeURIComponent(provider)}`, { method: "DELETE" }),

	answerOAuth: (provider: string, loginId: string, promptId: string, value: string) =>
		request<{ accepted: boolean }>(`/api/auth/oauth/${encodeURIComponent(provider)}/answer`, {
			method: "POST",
			body: JSON.stringify({ loginId, promptId, value }),
		}),

	cancelOAuth: (provider: string, loginId: string) =>
		request<{ cancelled: boolean }>(`/api/auth/oauth/${encodeURIComponent(provider)}/cancel`, {
			method: "POST",
			body: JSON.stringify({ loginId }),
		}),

	skills: () => request<SkillsResponse>("/api/skills"),

	setSkillModelInvocation: (name: string, disableModelInvocation: boolean) =>
		request<SkillsResponse>(`/api/skills/${encodeURIComponent(name)}`, {
			method: "PATCH",
			body: JSON.stringify({ disableModelInvocation }),
		}),

	plugins: () => request<PluginsResponse>("/api/plugins"),

	pluginAction: (action: "install" | "remove" | "update" | "enable" | "disable", source: string) =>
		request<PluginsResponse>("/api/plugins", { method: "POST", body: JSON.stringify({ action, source }) }),

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
