import { type SessionInfo, SessionManager } from "@earendil-works/pi-coding-agent";
import { SessionWrapper } from "./session-wrapper.ts";

export interface RegistryOptions {
	agentDir: string;
	/** Sessions with no traffic for this long are torn down. */
	idleTimeoutMs?: number;
	sweepIntervalMs?: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * Owns every live pi session in the process and answers the two questions the
 * HTTP layer keeps asking: "give me the session with this id" and "which
 * sessions are busy right now".
 */
export class SessionRegistry {
	private readonly sessions = new Map<string, SessionWrapper>();
	private readonly runningListeners = new Set<(ids: string[]) => void>();
	private readonly agentDir: string;
	private readonly idleTimeoutMs: number;
	private readonly sweepIntervalMs: number;
	private sweeper: NodeJS.Timeout | undefined;

	constructor(options: RegistryOptions) {
		this.agentDir = options.agentDir;
		this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
		this.sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
	}

	async create(cwd: string, toolNames?: string[]): Promise<SessionWrapper> {
		const wrapper = await SessionWrapper.open({ cwd, agentDir: this.agentDir, ...(toolNames && { toolNames }) });
		this.register(wrapper);
		return wrapper;
	}

	get(id: string): SessionWrapper | undefined {
		const wrapper = this.sessions.get(id);
		if (wrapper) wrapper.lastActivity = Date.now();
		return wrapper;
	}

	/** Return the live session, reopening it from disk when it was swept away. */
	async resolve(id: string): Promise<SessionWrapper | undefined> {
		const existing = this.get(id);
		if (existing) return existing;

		const info = await this.findSessionInfo(id);
		if (!info) return undefined;

		const wrapper = await SessionWrapper.open({
			cwd: info.cwd || this.agentDir,
			agentDir: this.agentDir,
			sessionFile: info.path,
		});
		this.register(wrapper);
		return wrapper;
	}

	private async findSessionInfo(id: string): Promise<SessionInfo | undefined> {
		const all = await SessionManager.listAll();
		return all.find((info) => info.id === id);
	}

	private register(wrapper: SessionWrapper): void {
		this.sessions.set(wrapper.id, wrapper);
		wrapper.onRunningChange(() => this.notifyRunning());
		this.notifyRunning();
	}

	runningIds(): string[] {
		return [...this.sessions.values()].filter((wrapper) => wrapper.isRunning).map((wrapper) => wrapper.id);
	}

	onRunningChange(listener: (ids: string[]) => void): () => void {
		this.runningListeners.add(listener);
		return () => {
			this.runningListeners.delete(listener);
		};
	}

	private notifyRunning(): void {
		const ids = this.runningIds();
		for (const listener of this.runningListeners) {
			try {
				listener(ids);
			} catch {
				// Never let a listener break session bookkeeping.
			}
		}
	}

	start(): void {
		if (this.sweeper) return;
		this.sweeper = setInterval(() => this.sweep(), this.sweepIntervalMs);
		this.sweeper.unref();
	}

	stop(): void {
		if (!this.sweeper) return;
		clearInterval(this.sweeper);
		this.sweeper = undefined;
	}

	private sweep(): void {
		const cutoff = Date.now() - this.idleTimeoutMs;
		for (const [id, wrapper] of this.sessions) {
			if (wrapper.isRunning || wrapper.lastActivity > cutoff) continue;
			wrapper.dispose();
			this.sessions.delete(id);
		}
	}

	disposeAll(): void {
		this.stop();
		for (const wrapper of this.sessions.values()) wrapper.dispose();
		this.sessions.clear();
	}
}
