import type { GatewayStatus, SessionSummary } from "@lares/shared";
import { defineStore } from "pinia";
import { ref } from "vue";
import { type AppConfig, api } from "../lib/api";

export const useAppStore = defineStore("app", () => {
	const config = ref<AppConfig | null>(null);
	const sessions = ref<SessionSummary[]>([]);
	const runningSessionIds = ref<string[]>([]);
	const gateway = ref<GatewayStatus | null>(null);
	const loading = ref(false);
	const error = ref<string | null>(null);

	async function loadConfig(): Promise<void> {
		config.value = await api.config();
	}

	async function loadSessions(): Promise<void> {
		loading.value = true;
		try {
			const result = await api.listSessions();
			sessions.value = result.sessions;
			runningSessionIds.value = result.runningSessionIds;
		} catch (err) {
			error.value = err instanceof Error ? err.message : String(err);
		} finally {
			loading.value = false;
		}
	}

	async function loadGatewayStatus(): Promise<void> {
		try {
			gateway.value = await api.gatewayStatus();
		} catch (err) {
			gateway.value = null;
			error.value = err instanceof Error ? err.message : String(err);
		}
	}

	return { config, sessions, runningSessionIds, gateway, loading, error, loadConfig, loadSessions, loadGatewayStatus };
});
