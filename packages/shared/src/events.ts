import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export type { AgentSessionEvent };

/** Handshake frame sent as the first SSE event on an agent stream. */
export interface ConnectedEvent {
	type: "connected";
	sessionId: string;
}

/** Emitted when a prompt finishes, so the client can settle its local state. */
export interface PromptDoneEvent {
	type: "prompt_done";
}

export interface PromptErrorEvent {
	type: "prompt_error";
	error: string;
}

/** Broadcast on the global stream whenever the set of busy sessions changes. */
export interface RunningSessionsEvent {
	type: "running";
	runningSessionIds: string[];
}

export type LaresEvent = ConnectedEvent | PromptDoneEvent | PromptErrorEvent | AgentSessionEvent;
