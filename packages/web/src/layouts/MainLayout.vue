<template>
	<q-layout view="hHh LpR fFf">
		<q-header elevated>
			<q-toolbar>
				<q-btn flat dense round icon="menu" aria-label="Sessions" @click="drawerOpen = !drawerOpen" />
				<q-toolbar-title>Lares</q-toolbar-title>

				<q-chip v-if="app.state?.model" dense outline color="white" text-color="white" icon="memory">
					{{ app.state.model.provider }}/{{ app.state.model.modelId }}
				</q-chip>

				<q-chip dense outline color="white" text-color="white" :icon="gatewayIcon">
					{{ gatewayLabel }}
					<q-tooltip>{{ gatewayTooltip }}</q-tooltip>
				</q-chip>
			</q-toolbar>
		</q-header>

		<q-drawer v-model="drawerOpen" show-if-above side="left" :width="300" bordered>
			<div class="q-pa-sm">
				<q-btn class="full-width" color="primary" icon="add" label="New session" @click="onNewSession" />
			</div>
			<q-separator />
			<q-list>
				<q-item-label header>Sessions</q-item-label>
				<q-item
					v-for="item in store.sessions"
					:key="item.id"
					clickable
					:active="item.id === app.sessionId"
					@click="onOpenSession(item.id)"
				>
					<q-item-section>
						<q-item-label lines="1">{{ item.name || item.firstMessage || "Untitled" }}</q-item-label>
						<q-item-label caption lines="1">{{ item.cwd }}</q-item-label>
					</q-item-section>
					<q-item-section v-if="store.runningSessionIds.includes(item.id)" side>
						<q-spinner-dots color="primary" />
					</q-item-section>
				</q-item>
				<q-item v-if="store.sessions.length === 0">
					<q-item-section class="text-grey-6">No sessions yet</q-item-section>
				</q-item>
			</q-list>
		</q-drawer>

		<q-page-container>
			<router-view />
		</q-page-container>
	</q-layout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useAppStore } from "../stores/app-store";
import { useSessionStore } from "../stores/session-store";

const store = useAppStore();
const app = useSessionStore();
const router = useRouter();
const drawerOpen = ref(true);

const gatewayLabel = computed(() => {
	if (!store.gateway) return "gateway ?";
	return store.gateway.reachable ? "gateway ok" : "gateway down";
});

const gatewayIcon = computed(() => (store.gateway?.reachable ? "cloud_done" : "cloud_off"));

const gatewayTooltip = computed(() => {
	if (!store.gateway) return "Gateway status unknown";
	const auth = store.gateway.usesBearer ? "user api key" : (store.gateway.appId ?? "no credentials");
	return `${store.gateway.baseUrl} (${auth})${store.gateway.error ? ` - ${store.gateway.error}` : ""}`;
});

onMounted(async () => {
	await Promise.all([store.loadConfig(), store.loadSessions(), store.loadGatewayStatus()]);
});

async function onNewSession(): Promise<void> {
	const cwd = store.config?.workspace;
	if (!cwd) return;
	await app.startSession(cwd);
	await store.loadSessions();
	await router.push({ name: "session", params: { id: app.sessionId } });
}

async function onOpenSession(id: string): Promise<void> {
	await router.push({ name: "session", params: { id } });
}
</script>
