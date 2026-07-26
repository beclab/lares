import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type AgentSessionEvent,
	type AgentSessionServices,
	createAgentSessionFromServices,
	createAgentSessionServices,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentCommand, ImageAttachment, LaresEvent, SessionState } from "@lares/shared";

export type EventListener = (event: LaresEvent) => void;

export interface OpenSessionOptions {
	cwd: string;
	agentDir: string;
	/** Existing `.jsonl` to resume. When omitted a new session file is created. */
	sessionFile?: string;
	toolNames?: string[];
}

function toImageContent(images: ImageAttachment[] | undefined): ImageContent[] | undefined {
	if (!images?.length) return undefined;
	return images.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }));
}

/**
 * One live pi session plus the plumbing the HTTP layer needs: a fan-out event
 * bus, a command dispatcher, and a running flag other components can observe.
 */
export class SessionWrapper {
	private readonly listeners = new Set<EventListener>();
	private readonly unsubscribe: () => void;
	private runningChangeHandler: (() => void) | undefined;
	private lastRunning: boolean;
	private disposed = false;

	lastActivity = Date.now();

	readonly session: AgentSession;
	readonly services: AgentSessionServices;
	readonly cwd: string;

	private constructor(session: AgentSession, services: AgentSessionServices, cwd: string) {
		this.session = session;
		this.services = services;
		this.cwd = cwd;
		this.lastRunning = this.isRunning;
		this.unsubscribe = session.subscribe((event: AgentSessionEvent) => {
			this.emit(event);
			this.checkRunningChange();
		});
	}

	static async open(options: OpenSessionOptions): Promise<SessionWrapper> {
		const services = await createAgentSessionServices({ cwd: options.cwd, agentDir: options.agentDir });
		const sessionManager = options.sessionFile
			? SessionManager.open(options.sessionFile, undefined, options.cwd)
			: SessionManager.create(options.cwd);
		const { session } = await createAgentSessionFromServices({
			services,
			sessionManager,
			...(options.toolNames ? { tools: options.toolNames } : {}),
		});
		return new SessionWrapper(session, services, options.cwd);
	}

	get id(): string {
		return this.session.sessionId;
	}

	get sessionFile(): string | undefined {
		return this.session.sessionFile;
	}

	get isRunning(): boolean {
		return this.session.isStreaming || this.session.isBashRunning || this.session.isCompacting;
	}

	onRunningChange(handler: () => void): void {
		this.runningChangeHandler = handler;
	}

	subscribe(listener: EventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private emit(event: LaresEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch {
				// A broken subscriber must not stall the agent or its other subscribers.
			}
		}
	}

	private checkRunningChange(): void {
		const running = this.isRunning;
		if (running === this.lastRunning) return;
		this.lastRunning = running;
		this.runningChangeHandler?.();
	}

	getState(): SessionState {
		const model = this.session.model;
		const usage = this.session.getContextUsage();
		return {
			sessionId: this.session.sessionId,
			sessionFile: this.session.sessionFile,
			cwd: this.cwd,
			isStreaming: this.session.isStreaming,
			isBashRunning: this.session.isBashRunning,
			isCompacting: this.session.isCompacting,
			autoCompactionEnabled: this.session.autoCompactionEnabled,
			autoRetryEnabled: this.session.autoRetryEnabled,
			model: model ? { provider: model.provider, modelId: model.id } : null,
			thinkingLevel: this.session.thinkingLevel,
			pendingMessageCount: this.session.pendingMessageCount,
			queuedMessages: {
				steering: [...this.session.getSteeringMessages()],
				followUp: [...this.session.getFollowUpMessages()],
			},
			contextUsage: usage ? { tokens: usage.tokens, contextWindow: usage.contextWindow, percent: usage.percent } : null,
			systemPrompt: this.session.systemPrompt,
			sessionName: this.session.sessionName,
			activeToolNames: this.session.getActiveToolNames(),
		};
	}

	async send(command: AgentCommand): Promise<unknown> {
		this.lastActivity = Date.now();
		switch (command.type) {
			case "ensure_session":
				return null;

			case "prompt": {
				// Prompts run past the HTTP response; progress and failure both
				// surface on the event stream instead of the command result.
				void this.session
					.prompt(command.message, {
						images: toImageContent(command.images),
						...(command.streamingBehavior ? { streamingBehavior: command.streamingBehavior } : {}),
					})
					.then(() => this.emit({ type: "prompt_done" }))
					.catch((err: unknown) => {
						this.emit({ type: "prompt_error", error: err instanceof Error ? err.message : String(err) });
					})
					.finally(() => this.checkRunningChange());
				this.checkRunningChange();
				return null;
			}

			case "steer":
				await this.session.steer(command.message, toImageContent(command.images));
				return null;

			case "follow_up":
				await this.session.followUp(command.message, toImageContent(command.images));
				return null;

			case "abort":
				await this.session.abort();
				this.checkRunningChange();
				return null;

			case "abort_bash":
				this.session.abortBash();
				return null;

			case "abort_compaction":
				this.session.abortCompaction();
				return null;

			case "get_state":
				return this.getState();

			case "set_model": {
				const model = this.services.modelRuntime.getModel(command.provider, command.modelId);
				if (!model) throw new Error(`Unknown model ${command.provider}/${command.modelId}`);
				await this.session.setModel(model);
				return { provider: command.provider, modelId: command.modelId };
			}

			case "set_thinking_level":
				this.session.setThinkingLevel(command.level as ThinkingLevel);
				return null;

			case "set_tools":
				this.session.setActiveToolsByName(command.toolNames);
				return null;

			case "get_tools":
				return this.session.getAllTools();

			case "get_session_stats":
				return this.session.getSessionStats();

			case "get_last_assistant_text":
				return this.session.getLastAssistantText() ?? null;

			case "set_session_name":
				this.session.setSessionName(command.name);
				return null;

			case "set_auto_compaction":
				this.session.setAutoCompactionEnabled(command.enabled);
				return null;

			case "set_auto_retry":
				this.session.setAutoRetryEnabled(command.enabled);
				return null;

			case "clear_queue":
				return this.session.clearQueue();

			case "compact": {
				// Compaction runs an LLM call of its own and can take a while. It
				// reports through compaction_start/compaction_end, so holding the
				// HTTP request open would only keep the abort button unreachable.
				void this.session.compact(command.customInstructions).catch((err: unknown) => {
					this.emit({ type: "prompt_error", error: err instanceof Error ? err.message : String(err) });
				});
				this.checkRunningChange();
				return null;
			}

			case "navigate_tree":
				return await this.session.navigateTree(command.targetId);

			case "bash": {
				const result = await this.session.executeBash(command.command, undefined, {
					excludeFromContext: command.excludeFromContext ?? false,
				});
				this.checkRunningChange();
				return result;
			}

			case "reload":
				await this.session.reload();
				return null;

			case "fork":
				throw new Error("Forking is not implemented yet");

			default: {
				const exhaustive: never = command;
				throw new Error(`Unknown command ${JSON.stringify(exhaustive)}`);
			}
		}
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribe();
		this.listeners.clear();
		this.session.dispose();
	}
}
