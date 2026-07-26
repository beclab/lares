<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useAppStore } from "../stores/app-store";
import { useSessionStore } from "../stores/session-store";

const app = useAppStore();
const session = useSessionStore();
const router = useRouter();
const drawerOpen = ref(true);

const gatewayLabel = computed(() => {
	if (!app.gateway) return "gateway ?";
	return app.gateway.reachable ? "gateway ok" : "gateway down";
});

const gatewayIcon = computed(() => (app.gateway?.reachable ? "cloud_done" : "cloud_off"));

const gatewayTooltip = computed(() => {
	if (!app.gateway) return "Gateway status unknown";
	const auth = app.gateway.usesBearer ? "user api key" : (app.gateway.appId ?? "no credentials");
	return `${app.gateway.baseUrl} (${auth})${app.gateway.error ? ` - ${app.gateway.error}` : ""}`;
});

onMounted(async () => {
	await Promise.all([app.loadConfig(), app.loadSessions(), app.loadGatewayStatus()]);
});

async function onNewSession(): Promise<void> {
	const cwd = app.config?.workspace;
	if (!cwd) return;
	await session.startSession(cwd);
	await app.loadSessions();
	await router.push({ name: "session", params: { id: session.sessionId } });
}

async function onOpenSession(id: string): Promise<void> {
	await router.push({ name: "session", params: { id } });
}
</script>

<template>
	<q-layout view="hHh LpR fFf">
		<q-header elevated>
			<q-toolbar>
				<q-btn flat dense round icon="menu" aria-label="Sessions" @click="drawerOpen = !drawerOpen" />
				<q-toolbar-title>Lares</q-toolbar-title>

				<q-chip v-if="session.state?.model" dense outline color="white" text-color="white" icon="memory">
					{{ session.state.model.provider }}/{{ session.state.model.modelId }}
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
					v-for="item in app.sessions"
					:key="item.id"
					clickable
					:active="item.id === session.sessionId"
					@click="onOpenSession(item.id)"
				>
					<q-item-section>
						<q-item-label lines="1">{{ item.name || item.firstMessage || "Untitled" }}</q-item-label>
						<q-item-label caption lines="1">{{ item.cwd }}</q-item-label>
					</q-item-section>
					<q-item-section v-if="app.runningSessionIds.includes(item.id)" side>
						<q-spinner-dots color="primary" />
					</q-item-section>
				</q-item>
				<q-item v-if="app.sessions.length === 0">
					<q-item-section class="text-grey-6">No sessions yet</q-item-section>
				</q-item>
			</q-list>
		</q-drawer>

		<q-page-container>
			<router-view />
		</q-page-container>
	</q-layout>
</template>
