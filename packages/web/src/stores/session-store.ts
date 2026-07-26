import type { AgentCommand, AgentMessage, LaresEvent, SessionState } from "@lares/shared";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api, subscribeToSession } from "../lib/api";

/**
 * Holds the conversation the user is currently looking at.
 *
 * pi emits whole messages rather than deltas, so streaming is handled by
 * replacing the trailing message instead of patching text in place.
 */
export const useSessionStore = defineStore("session", () => {
	const sessionId = ref<string | null>(null);
	const cwd = ref<string>("");
	const messages = ref<AgentMessage[]>([]);
	const state = ref<SessionState | null>(null);
	const connected = ref(false);
	const error = ref<string | null>(null);

	let unsubscribe: (() => void) | null = null;

	const isStreaming = computed(() => state.value?.isStreaming ?? false);

	function reset(): void {
		unsubscribe?.();
		unsubscribe = null;
		sessionId.value = null;
		messages.value = [];
		state.value = null;
		connected.value = false;
		error.value = null;
	}

	function applyEvent(event: LaresEvent): void {
		switch (event.type) {
			case "connected":
				connected.value = true;
				void refreshState();
				break;
			case "message_start":
				messages.value = [...messages.value, event.message];
				break;
			case "message_update":
			case "message_end": {
				const next = [...messages.value];
				if (next.length === 0) next.push(event.message);
				else next[next.length - 1] = event.message;
				messages.value = next;
				break;
			}
			case "prompt_error":
				error.value = event.error;
				void refreshState();
				break;
			case "agent_end":
			case "prompt_done":
			case "agent_settled":
				void refreshState();
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
			error.value = err instanceof Error ? err.message : String(err);
		}
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
		const id = await api.createSession(workingDirectory, { type: "ensure_session" });
		attach(id);
		await refreshState();
		return id;
	}

	async function openSession(id: string): Promise<void> {
		reset();
		const detail = await api.getSession(id);
		cwd.value = detail.session.cwd;
		messages.value = extractMessages(detail.entries);
		attach(id);
		await refreshState();
	}

	async function send(command: AgentCommand): Promise<void> {
		if (!sessionId.value) throw new Error("No active session");
		error.value = null;
		await api.send(sessionId.value, command);
		await refreshState();
	}

	async function sendPrompt(text: string): Promise<void> {
		const streamingNow = state.value?.isStreaming ?? false;
		await send({
			type: "prompt",
			message: text,
			...(streamingNow ? { streamingBehavior: "followUp" as const } : {}),
		});
	}

	return {
		sessionId,
		cwd,
		messages,
		state,
		connected,
		error,
		isStreaming,
		reset,
		startSession,
		openSession,
		send,
		sendPrompt,
		refreshState,
	};
});

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
