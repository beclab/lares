import type {
	AgentCommand,
	AgentMessage,
	ImageAttachment,
	LaresEvent,
	SessionState,
	SessionTreeResponse,
	ToolResultMessage,
	UserMessage,
} from "@lares/shared";
import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import { api, subscribeToSession } from "../lib/api";
import { commitUserEcho, indexToolResults, type SubmitIntent, userContent } from "../lib/messages";
import { readSession, writeSession } from "../lib/session-cache";
import { useAppStore } from "./app-store";

/** What the agent is doing between messages, so the UI can say more than "thinking". */
export type AgentPhase =
	| { kind: "idle" }
	| { kind: "waiting_model" }
	| { kind: "running_tools"; tools: string[] }
	| { kind: "compacting" };

export interface CompactResult {
	reason: string;
	tokensBefore: number;
	tokensAfter: number;
}

export interface RetryInfo {
	attempt: number;
	maxAttempts: number;
	error: string;
}

/**
 * Holds the conversation the user is currently looking at.
 *
 * pi streams whole messages rather than text deltas, so a partial assistant
 * message lives outside the committed list until `message_end` promotes it.
 * Rendering both sources keeps the transcript stable while the tail animates.
 */
export const useSessionStore = defineStore("session", () => {
	const sessionId = ref<string | null>(null);
	const cwd = ref<string>("");
	const messages = shallowRef<AgentMessage[]>([]);
	/** Bubbles rendered on send, still waiting for pi to echo them back. */
	const pendingOptimistic = shallowRef<UserMessage[]>([]);
	const streamingMessage = shallowRef<AgentMessage | null>(null);
	const state = ref<SessionState | null>(null);
	const connected = ref(false);
	const error = ref<string | null>(null);

	const agentRunning = ref(false);
	const phase = ref<AgentPhase>({ kind: "idle" });
	const runningToolIds = ref<Set<string>>(new Set());
	const compactResult = ref<CompactResult | null>(null);
	const retryInfo = ref<RetryInfo | null>(null);
	const tree = ref<SessionTreeResponse | null>(null);

	let unsubscribe: (() => void) | null = null;
	/** Bumped whenever the transcript changes, so a late fetch cannot undo it. */
	let transcriptEpoch = 0;

	const busy = computed(() => agentRunning.value || (state.value?.isBashRunning ?? false));
	const isCompacting = computed(() => state.value?.isCompacting === true || phase.value.kind === "compacting");
	const queued = computed(() => state.value?.queuedMessages ?? { steering: [], followUp: [] });
	const queuedCount = computed(() => queued.value.steering.length + queued.value.followUp.length);
	const contextUsage = computed(() => state.value?.contextUsage ?? null);

	/**
	 * Tool results are rendered inside the call that produced them, so the
	 * streaming tail has to see results that already landed in the committed list.
	 */
	const toolResults = computed<Map<string, ToolResultMessage>>(() => indexToolResults(messages.value));

	const visibleMessages = computed(() => messages.value.filter(isRenderable));

	function reset(): void {
		// Leaving is the moment the transcript on screen is worth keeping: it is
		// the newest version anyone has, stream updates included.
		if (sessionId.value && messages.value.length > 0) {
			writeSession(sessionId.value, { cwd: cwd.value, messages: messages.value });
		}
		unsubscribe?.();
		unsubscribe = null;
		transcriptEpoch += 1;
		sessionId.value = null;
		messages.value = [];
		pendingOptimistic.value = [];
		streamingMessage.value = null;
		state.value = null;
		connected.value = false;
		error.value = null;
		agentRunning.value = false;
		phase.value = { kind: "idle" };
		runningToolIds.value = new Set();
		compactResult.value = null;
		retryInfo.value = null;
		tree.value = null;
	}

	function applyEvent(event: LaresEvent): void {
		switch (event.type) {
			case "connected":
			case "state":
				state.value = event.state;
				if (event.type === "connected") connected.value = true;
				if (sessionId.value) useAppStore().noteName(sessionId.value, event.state.sessionName);
				break;

			case "agent_start":
				agentRunning.value = true;
				phase.value = { kind: "waiting_model" };
				error.value = null;
				break;

			case "agent_end":
				agentRunning.value = false;
				streamingMessage.value = null;
				phase.value = { kind: "idle" };
				runningToolIds.value = new Set();
				break;

			case "message_start":
			case "message_update":
				// User messages are echoed back after being sent; the optimistic
				// bubble already covers them, and adopting the echo would duplicate it.
				if (event.message.role === "user") break;
				streamingMessage.value = event.message;
				phase.value = { kind: "waiting_model" };
				break;

			case "message_end": {
				streamingMessage.value = null;
				const committed = commitUserEcho(messages.value, pendingOptimistic.value, event.message);
				messages.value = committed.messages;
				pendingOptimistic.value = committed.pending;
				transcriptEpoch += 1;
				if (sessionId.value) {
					const text = event.message.role === "user" ? userContent(event.message.content).text : "";
					const app = useAppStore();
					// pi writes the session file only once it holds a reply, so a new
					// session is missing from the list until its first message lands.
					if (!app.noteMessage(sessionId.value, text) && !app.loading) void app.loadSessions();
				}
				break;
			}

			case "tool_execution_start": {
				const next = new Set(runningToolIds.value);
				next.add(event.toolCallId);
				runningToolIds.value = next;
				phase.value = { kind: "running_tools", tools: [...next] };
				break;
			}

			case "tool_execution_end": {
				const next = new Set(runningToolIds.value);
				next.delete(event.toolCallId);
				runningToolIds.value = next;
				phase.value = next.size > 0 ? { kind: "running_tools", tools: [...next] } : { kind: "waiting_model" };
				break;
			}

			case "queue_update":
				if (state.value) {
					state.value = {
						...state.value,
						queuedMessages: { steering: [...event.steering], followUp: [...event.followUp] },
					};
				}
				break;

			case "compaction_start":
				phase.value = { kind: "compacting" };
				compactResult.value = null;
				break;

			case "compaction_end":
				phase.value = agentRunning.value ? { kind: "waiting_model" } : { kind: "idle" };
				if (event.errorMessage) error.value = event.errorMessage;
				else if (event.result && !event.aborted) {
					compactResult.value = {
						reason: event.reason,
						tokensBefore: event.result.tokensBefore,
						tokensAfter: event.result.estimatedTokensAfter ?? 0,
					};
				}
				void reload();
				break;

			case "auto_retry_start":
				retryInfo.value = { attempt: event.attempt, maxAttempts: event.maxAttempts, error: event.errorMessage };
				break;

			case "auto_retry_end":
				retryInfo.value = null;
				if (!event.success && event.finalError) error.value = event.finalError;
				break;

			case "prompt_error":
				error.value = event.error;
				agentRunning.value = false;
				streamingMessage.value = null;
				phase.value = { kind: "idle" };
				break;

			case "prompt_done":
			case "agent_settled":
				agentRunning.value = false;
				streamingMessage.value = null;
				phase.value = { kind: "idle" };
				break;

			default:
				break;
		}
	}

	async function refreshState(): Promise<void> {
		if (!sessionId.value) return;
		try {
			state.value = await api.getState(sessionId.value);
		} catch (err) {
			error.value = describe(err);
		}
	}

	/** Re-reads the transcript from disk, which compaction and branching rewrite. */
	async function reload(): Promise<void> {
		if (!sessionId.value) return;
		const detail = await api.getSession(sessionId.value);
		messages.value = extractMessages(detail.entries);
		// Disk is authoritative, so any bubble still waiting for an echo is
		// either already in the transcript or was never persisted.
		pendingOptimistic.value = [];
		transcriptEpoch += 1;
		if (tree.value) await loadTree();
	}

	async function loadTree(): Promise<void> {
		if (!sessionId.value) return;
		tree.value = await api.getSessionTree(sessionId.value);
	}

	/**
	 * Moves the leaf pointer back to an earlier entry. The abandoned path stays
	 * in the file, which is what makes the branch tree worth showing.
	 */
	async function navigateTo(entryId: string): Promise<void> {
		await send({ type: "navigate_tree", targetId: entryId });
		await reload();
	}

	function attach(id: string): void {
		unsubscribe?.();
		sessionId.value = id;
		unsubscribe = subscribeToSession(id, applyEvent, () => {
			connected.value = false;
		});
	}

	async function startSession(workingDirectory: string): Promise<string> {
		reset();
		cwd.value = workingDirectory;
		const created = await api.createSession(workingDirectory, { type: "ensure_session" });
		attach(created.sessionId);
		state.value = created.state;
		return created.sessionId;
	}

	/**
	 * Opens a session, painting a cached transcript first when there is one.
	 *
	 * State arrives on the stream's handshake frame, so this costs one request
	 * rather than two, and none at all on screen when the cache answers.
	 */
	async function openSession(id: string): Promise<void> {
		reset();
		const cached = readSession(id);
		if (cached) {
			cwd.value = cached.cwd;
			messages.value = cached.messages;
			attach(id);
			void revalidate(id);
			return;
		}

		const detail = await api.getSession(id);
		cwd.value = detail.session.cwd;
		messages.value = extractMessages(detail.entries);
		attach(id);
	}

	/**
	 * Replaces a cached transcript with the one on disk, unless the session
	 * moved on while the request was in flight. Anything the stream delivered
	 * in the meantime is newer than what the server was asked for.
	 */
	async function revalidate(id: string): Promise<void> {
		const epoch = transcriptEpoch;
		try {
			const detail = await api.getSession(id);
			if (sessionId.value !== id || transcriptEpoch !== epoch) return;
			cwd.value = detail.session.cwd;
			messages.value = extractMessages(detail.entries);
		} catch (err) {
			error.value = describe(err);
		}
	}

	async function send<T = unknown>(command: AgentCommand): Promise<T> {
		if (!sessionId.value) throw new Error("No active session");
		error.value = null;
		const result = await api.send<T>(sessionId.value, command);
		state.value = result.state;
		return result.data;
	}

	/**
	 * Routes a prompt by what the agent is doing. Steering interrupts the current
	 * turn; a follow-up waits for it. Both are queued by pi, not by us.
	 */
	async function submit(text: string, images: ImageAttachment[], intent: SubmitIntent): Promise<void> {
		const attachments = images.length > 0 ? { images } : {};

		if (!busy.value) {
			const bubble = optimisticUserMessage(text, images);
			messages.value = [...messages.value, bubble];
			pendingOptimistic.value = [...pendingOptimistic.value, bubble];
			transcriptEpoch += 1;
			agentRunning.value = true;
			phase.value = { kind: "waiting_model" };
			await send({ type: "prompt", message: text, ...attachments });
			return;
		}

		const behaviour = intent === "auto" ? "steer" : intent;
		await send(
			behaviour === "steer"
				? { type: "steer", message: text, ...attachments }
				: { type: "follow_up", message: text, ...attachments },
		);
	}

	async function abort(): Promise<void> {
		await send(state.value?.isBashRunning ? { type: "abort_bash" } : { type: "abort" });
		agentRunning.value = false;
		streamingMessage.value = null;
		phase.value = { kind: "idle" };
	}

	async function runBash(command: string, excludeFromContext: boolean): Promise<void> {
		await send({ type: "bash", command, excludeFromContext });
		await reload();
	}

	async function compact(customInstructions?: string): Promise<void> {
		await send(customInstructions ? { type: "compact", customInstructions } : { type: "compact" });
	}

	async function clearQueue(): Promise<{ steering: string[]; followUp: string[] }> {
		const cleared = queued.value;
		await send({ type: "clear_queue" });
		return { steering: [...cleared.steering], followUp: [...cleared.followUp] };
	}

	return {
		sessionId,
		cwd,
		messages: visibleMessages,
		streamingMessage,
		toolResults,
		runningToolIds,
		state,
		connected,
		error,
		agentRunning,
		phase,
		busy,
		isCompacting,
		queued,
		queuedCount,
		contextUsage,
		compactResult,
		retryInfo,
		tree,
		reset,
		startSession,
		openSession,
		reload,
		loadTree,
		navigateTo,
		send,
		submit,
		abort,
		runBash,
		compact,
		clearQueue,
		refreshState,
	};
});

function describe(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** Shown immediately on send so the input clears without waiting for a round trip. */
function optimisticUserMessage(text: string, images: ImageAttachment[]): UserMessage {
	const content = images.length
		? [
				{ type: "text" as const, text },
				...images.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType })),
			]
		: text;
	return { role: "user", content, timestamp: Date.now() };
}

/** Tool results render inside their call, and hidden custom messages are internal. */
function isRenderable(message: AgentMessage): boolean {
	if (message.role === "toolResult") return false;
	if (message.role === "custom") return message.display;
	return true;
}

/** Session entries carry more than messages; keep only what the chat renders. */
function extractMessages(entries: unknown[]): AgentMessage[] {
	const messages: AgentMessage[] = [];
	for (const entry of entries) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry as { type?: unknown; message?: unknown };
		if (record.type === "message" && record.message) messages.push(record.message as AgentMessage);
	}
	return messages;
}
