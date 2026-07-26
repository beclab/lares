export type StreamingBehavior = "steer" | "followUp";

export interface ImageAttachment {
	type: "image";
	/** Base64-encoded image payload without a data URL prefix. */
	data: string;
	mimeType: string;
}

export type AgentCommand =
	| { type: "ensure_session" }
	| {
			type: "prompt";
			message: string;
			images?: ImageAttachment[];
			streamingBehavior?: StreamingBehavior;
	  }
	| { type: "steer"; message: string; images?: ImageAttachment[] }
	| { type: "follow_up"; message: string; images?: ImageAttachment[] }
	| { type: "abort" }
	| { type: "abort_bash" }
	| { type: "abort_compaction" }
	| { type: "get_state" }
	| { type: "set_model"; provider: string; modelId: string }
	| { type: "set_thinking_level"; level: string }
	| { type: "set_tools"; toolNames: string[] }
	| { type: "get_tools" }
	| { type: "get_session_stats" }
	| { type: "get_last_assistant_text" }
	| { type: "set_session_name"; name: string }
	| { type: "set_auto_compaction"; enabled: boolean }
	| { type: "set_auto_retry"; enabled: boolean }
	| { type: "clear_queue" }
	| { type: "compact"; customInstructions?: string }
	| { type: "fork"; entryId: string }
	| { type: "navigate_tree"; targetId: string }
	| { type: "bash"; command: string; excludeFromContext?: boolean }
	| { type: "reload" };

export type AgentCommandType = AgentCommand["type"];

export interface CommandSuccess<T = unknown> {
	success: true;
	data: T;
	sessionId?: string;
}

export interface CommandFailure {
	success: false;
	error: string;
	code?: string;
}

export type CommandResult<T = unknown> = CommandSuccess<T> | CommandFailure;

/** Body of POST /api/agent/new. */
export interface CreateSessionRequest {
	cwd: string;
	command: AgentCommand;
	toolNames?: string[];
}
