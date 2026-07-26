export interface ModelRef {
	provider: string;
	modelId: string;
}

export interface ContextUsageInfo {
	/** Null right after compaction, before the next assistant response reports usage. */
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

export interface SessionState {
	sessionId: string;
	sessionFile: string | undefined;
	cwd: string;
	isStreaming: boolean;
	isBashRunning: boolean;
	isCompacting: boolean;
	autoCompactionEnabled: boolean;
	autoRetryEnabled: boolean;
	model: ModelRef | null;
	thinkingLevel: string;
	pendingMessageCount: number;
	queuedMessages: { steering: string[]; followUp: string[] };
	contextUsage: ContextUsageInfo | null;
	systemPrompt: string;
	sessionName: string | undefined;
	activeToolNames: string[];
}

export interface SessionSummary {
	id: string;
	path: string;
	cwd: string;
	name?: string;
	parentSessionPath?: string;
	created: string;
	modified: string;
	messageCount: number;
	firstMessage: string;
}

export interface SessionListResponse {
	sessions: SessionSummary[];
	runningSessionIds: string[];
}

export interface AvailableModel {
	provider: string;
	modelId: string;
	name: string;
	reasoning: boolean;
	input: string[];
	contextWindow: number;
	maxTokens: number;
}

export interface ModelsResponse {
	models: AvailableModel[];
	defaultModel: ModelRef | null;
	error?: string;
}

export interface GatewaySyncResult {
	/** Model ids discovered on the gateway, in `provider/id` form where available. */
	discovered: string[];
	/** Ids newly written into models.json. */
	added: string[];
	/** Ids already present and therefore left untouched. */
	kept: string[];
}

export interface GatewayStatus {
	baseUrl: string;
	appId: string | null;
	usesBearer: boolean;
	reachable: boolean;
	error?: string;
}

export interface ErrorResponse {
	error: string;
	code?: string;
	hint?: string;
}
