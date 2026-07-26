import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { SessionState } from "./api.ts";

export type { AgentSessionEvent };

/** Handshake frame sent as the first SSE event on an agent stream. */
export interface ConnectedEvent {
	type: "connected";
	sessionId: string;
	state: SessionState;
}

/**
 * A state snapshot pushed after the agent settles.
 *
 * The SDK's own events say what happened but not what the session looks like
 * afterwards, and asking costs a round trip the client can feel.
 */
export interface StateEvent {
	type: "state";
	state: SessionState;
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

export type LaresEvent = ConnectedEvent | StateEvent | PromptDoneEvent | PromptErrorEvent | AgentSessionEvent;
