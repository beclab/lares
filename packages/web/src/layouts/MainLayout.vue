<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import FileTree from "../components/FileTree.vue";
import FileViewer from "../components/FileViewer.vue";
import SessionList from "../components/SessionList.vue";
import WorktreeSwitcher from "../components/WorktreeSwitcher.vue";
import { useAppStore } from "../stores/app-store";
import { useFilesStore } from "../stores/files-store";
import { useSessionStore } from "../stores/session-store";
import { useWorkspaceStore } from "../stores/workspace-store";

const app = useAppStore();
const session = useSessionStore();
const files = useFilesStore();
const workspace = useWorkspaceStore();
const router = useRouter();
const drawerOpen = ref(true);
const filesOpen = ref(false);
const viewerPath = ref<string | null>(null);

const gatewayLabel = computed(() => {
	if (!app.gateway) return "gateway ?";
	return app.gateway.reachable ? "gateway ok" : "gateway down";
});

const gatewayIcon = computed(() => (app.gateway?.reachable ? "cloud_done" : "cloud_off"));

const viewerVisible = computed({
	get: () => viewerPath.value !== null,
	set: (open: boolean) => {
		if (!open) viewerPath.value = null;
	},
});

const gatewayTooltip = computed(() => {
	if (!app.gateway) return "Gateway status unknown";
	const auth = app.gateway.usesBearer ? "user api key" : (app.gateway.appId ?? "no credentials");
	return `${app.gateway.baseUrl} (${auth})${app.gateway.error ? ` - ${app.gateway.error}` : ""}`;
});

onMounted(async () => {
	await Promise.all([app.loadConfig(), app.loadSessions(), app.loadGatewayStatus()]);
});

// Switching checkouts re-roots the tree, so what the user browses is always the
// branch the next session will run against.
watch(
	() => workspace.relativeCwd,
	async (path) => {
		if (filesOpen.value) await files.setRoot(path);
		else files.root = path;
	},
);

async function onNewSession(): Promise<void> {
	const cwd = workspace.cwd;
	if (!cwd) return;
	await session.startSession(cwd);
	await app.loadSessions();
	await router.push({ name: "session", params: { id: session.sessionId } });
}

async function onOpenSession(id: string): Promise<void> {
	await router.push({ name: "session", params: { id } });
}

async function onSessionDeleted(id: string): Promise<void> {
	if (session.sessionId !== id) return;
	session.reset();
	await router.push({ name: "chat" });
}

async function toggleFiles(): Promise<void> {
	filesOpen.value = !filesOpen.value;
	// The tree is only worth loading once someone asks to see it.
	if (filesOpen.value && files.children.size === 0) await files.init();
}

function onMention(path: string): void {
	files.requestMention(path);
	viewerPath.value = null;
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

				<q-btn flat dense round icon="folder" aria-label="Files" @click="toggleFiles">
					<q-badge v-if="files.changedCount > 0" floating color="orange">{{ files.changedCount }}</q-badge>
					<q-tooltip>Workspace files</q-tooltip>
				</q-btn>

				<q-btn flat dense round icon="settings" aria-label="Settings" :to="{ name: 'settings' }">
					<q-tooltip>Settings</q-tooltip>
				</q-btn>
			</q-toolbar>
		</q-header>

		<q-drawer v-model="drawerOpen" show-if-above side="left" :width="300" bordered>
			<div class="q-pa-sm">
				<q-btn class="full-width" color="primary" icon="add" label="New session" @click="onNewSession" />
				<WorktreeSwitcher class="q-mt-sm" />
			</div>
			<q-separator />
			<SessionList :active-id="session.sessionId" @open="onOpenSession" @deleted="onSessionDeleted" />
		</q-drawer>

		<q-drawer v-model="filesOpen" side="right" :width="330" bordered>
			<FileTree @open="viewerPath = $event" @mention="onMention" />
		</q-drawer>

		<q-page-container>
			<router-view />
		</q-page-container>

		<q-dialog v-model="viewerVisible" maximized>
			<q-card class="viewer-card">
				<FileViewer :path="viewerPath" @close="viewerPath = null" @mention="onMention" />
			</q-card>
		</q-dialog>
	</q-layout>
</template>

<style scoped lang="scss">
.viewer-card {
	display: flex;
	flex-direction: column;
	height: 100%;
}
</style>
