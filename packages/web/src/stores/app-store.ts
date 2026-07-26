import type { GatewayStatus, SessionSummary } from "@lares/shared";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { type AppConfig, api, type ForkMode } from "../lib/api";
import { forgetSession } from "../lib/session-cache";

export interface SessionGroup {
	cwd: string;
	label: string;
	sessions: SessionSummary[];
}

export const useAppStore = defineStore("app", () => {
	const config = ref<AppConfig | null>(null);
	const sessions = ref<SessionSummary[]>([]);
	const runningSessionIds = ref<string[]>([]);
	const gateway = ref<GatewayStatus | null>(null);
	const loading = ref(false);
	const error = ref<string | null>(null);
	const filter = ref("");

	const matching = computed(() => {
		const needle = filter.value.trim().toLowerCase();
		if (!needle) return sessions.value;
		return sessions.value.filter((session) => {
			const haystack = `${session.name ?? ""} ${session.firstMessage} ${session.cwd}`.toLowerCase();
			return haystack.includes(needle);
		});
	});

	/**
	 * Sessions are grouped by working directory because that is what a project
	 * means to pi: the session files live in a per-cwd directory.
	 */
	const groups = computed<SessionGroup[]>(() => {
		const byCwd = new Map<string, SessionSummary[]>();
		for (const session of matching.value) {
			const list = byCwd.get(session.cwd);
			if (list) list.push(session);
			else byCwd.set(session.cwd, [session]);
		}
		return [...byCwd.entries()]
			.map(([cwd, list]) => ({ cwd, label: cwd.split("/").filter(Boolean).pop() ?? cwd, sessions: list }))
			.sort((a, b) => a.label.localeCompare(b.label));
	});

	async function loadConfig(): Promise<void> {
		config.value = await api.config();
	}

	async function loadSessions(): Promise<void> {
		loading.value = true;
		try {
			const result = await api.listSessions();
			sessions.value = [...result.sessions].sort(byRecency);
			runningSessionIds.value = result.runningSessionIds;
		} catch (err) {
			error.value = describe(err);
		} finally {
			loading.value = false;
		}
	}

	/** Returns false when the session is not in the list, so callers can refetch. */
	function patch(id: string, changes: (session: SessionSummary) => Partial<SessionSummary> | null): boolean {
		const index = sessions.value.findIndex((entry) => entry.id === id);
		const current = sessions.value[index];
		if (!current) return false;
		const delta = changes(current);
		if (!delta) return true;
		const next = [...sessions.value];
		next[index] = { ...current, ...delta };
		sessions.value = next.sort(byRecency);
		return true;
	}

	/**
	 * Records a message the live stream just reported, so the sidebar keeps up
	 * without refetching the whole list after every turn. One `message_end` is
	 * one entry in the transcript file, which is exactly what the server counts.
	 */
	function noteMessage(id: string, text: string): boolean {
		return patch(id, (session) => ({
			modified: new Date().toISOString(),
			messageCount: session.messageCount + 1,
			...(session.firstMessage || !text ? {} : { firstMessage: text }),
		}));
	}

	/** Picks up auto-naming, which otherwise only shows after a full reload. */
	function noteName(id: string, name: string | undefined): void {
		patch(id, (session) => (name && name !== session.name ? { name } : null));
	}

	async function loadGatewayStatus(): Promise<void> {
		try {
			gateway.value = await api.gatewayStatus();
		} catch (err) {
			gateway.value = null;
			error.value = describe(err);
		}
	}

	async function rename(id: string, name: string): Promise<void> {
		await api.renameSession(id, name);
		await loadSessions();
	}

	async function remove(id: string): Promise<void> {
		await api.deleteSession(id);
		forgetSession(id);
		await loadSessions();
	}

	async function fork(id: string, entryId?: string, mode?: ForkMode): Promise<string> {
		const result = await api.forkSession(id, entryId, mode);
		await loadSessions();
		return result.sessionId;
	}

	return {
		config,
		sessions,
		groups,
		filter,
		runningSessionIds,
		gateway,
		loading,
		error,
		loadConfig,
		loadSessions,
		loadGatewayStatus,
		noteMessage,
		noteName,
		rename,
		remove,
		fork,
	};
});

function byRecency(a: SessionSummary, b: SessionSummary): number {
	return new Date(b.modified).getTime() - new Date(a.modified).getTime();
}

function describe(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
