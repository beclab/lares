<script setup lang="ts">
import type { ImageAttachment } from "@lares/shared";
import { onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import BranchTree from "../components/BranchTree.vue";
import ChatInput from "../components/ChatInput.vue";
import ContextMeter from "../components/ContextMeter.vue";
import MessageList from "../components/MessageList.vue";
import type { SubmitIntent } from "../lib/messages";
import { useAppStore } from "../stores/app-store";
import { useSessionStore } from "../stores/session-store";
import { useWorkspaceStore } from "../stores/workspace-store";

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const session = useSessionStore();
const workspace = useWorkspaceStore();

const recalled = ref("");
const showBranches = ref(false);

watch(
	() => route.params.id,
	async (id) => {
		if (typeof id !== "string" || id.length === 0) return;
		if (session.sessionId === id) return;
		await session.openSession(id);
	},
	{ immediate: true },
);

onUnmounted(() => session.reset());

async function startSession(): Promise<void> {
	const cwd = workspace.cwd;
	if (!cwd) return;
	await session.startSession(cwd);
	await app.loadSessions();
	await router.push({ name: "session", params: { id: session.sessionId } });
}

async function onSubmit(text: string, images: ImageAttachment[], intent: SubmitIntent): Promise<void> {
	// The sidebar follows the live stream, so sending costs one request.
	await session.submit(text, images, intent);
}

async function onBash(command: string, excludeFromContext: boolean): Promise<void> {
	await session.runBash(command, excludeFromContext);
}

async function onRecallQueue(): Promise<void> {
	const cleared = await session.clearQueue();
	recalled.value = [...cleared.steering, ...cleared.followUp].join("\n");
}

async function toggleBranches(): Promise<void> {
	showBranches.value = !showBranches.value;
	if (showBranches.value) await session.loadTree();
}

async function onNavigate(entryId: string): Promise<void> {
	await session.navigateTo(entryId);
}

async function onFork(entryId: string, mode: "at" | "before"): Promise<void> {
	if (!session.sessionId) return;
	try {
		const id = await app.fork(session.sessionId, entryId, mode);
		showBranches.value = false;
		await router.push({ name: "session", params: { id } });
	} catch (err) {
		session.error = err instanceof Error ? err.message : String(err);
	}
}
</script>

<template>
	<q-page class="chat">
		<q-banner v-if="session.error" dense class="bg-negative text-white">
			{{ session.error }}
			<template #action>
				<q-btn flat dense label="Dismiss" @click="session.error = null" />
			</template>
		</q-banner>

		<q-banner v-if="session.retryInfo" dense class="bg-warning text-black">
			Retrying after an error (attempt {{ session.retryInfo.attempt }} of {{ session.retryInfo.maxAttempts }}):
			{{ session.retryInfo.error }}
		</q-banner>

		<q-banner v-if="session.compactResult" dense class="bg-positive text-white">
			Compacted {{ session.compactResult.tokensBefore }} tokens down to about
			{{ session.compactResult.tokensAfter }}.
			<template #action>
				<q-btn flat dense label="Dismiss" @click="session.compactResult = null" />
			</template>
		</q-banner>

		<div v-if="!session.sessionId" class="chat__empty">
			<q-icon name="forum" size="64px" />
			<div>Pick a session or start a new one.</div>
			<q-btn color="primary" icon="add" label="New session" :disable="!app.config" @click="startSession" />
		</div>

		<template v-else>
			<q-slide-transition>
				<div v-show="showBranches" class="chat__branches">
					<BranchTree
						:roots="session.tree?.roots ?? []"
						:leaf-id="session.tree?.leafId ?? null"
						@navigate="onNavigate"
						@fork="onFork"
					/>
				</div>
			</q-slide-transition>

			<MessageList
				:messages="session.messages"
				:streaming-message="session.streamingMessage"
				:tool-results="session.toolResults"
				:running-tool-ids="session.runningToolIds"
				:phase="session.phase"
				:agent-running="session.agentRunning"
			/>

			<div class="chat__status">
				<span class="chat__cwd">{{ session.cwd }}</span>
				<q-btn
					dense
					flat
					size="sm"
					icon="account_tree"
					:color="showBranches ? 'primary' : undefined"
					@click="toggleBranches"
				>
					<q-tooltip>Branches</q-tooltip>
				</q-btn>
				<ContextMeter :usage="session.contextUsage" />
				<q-icon
					:name="session.connected ? 'wifi' : 'wifi_off'"
					:color="session.connected ? 'positive' : 'grey'"
					size="16px"
				/>
			</div>

			<ChatInput
				:busy="session.busy"
				:compacting="session.isCompacting"
				:queued="session.queued"
				@submit="onSubmit"
				@bash="onBash"
				@abort="session.abort"
				@compact="session.compact()"
				@recall-queue="onRecallQueue"
			/>
		</template>
	</q-page>
</template>

<style scoped lang="scss">
.chat {
	display: flex;
	flex-direction: column;
	height: calc(100vh - 50px);
	min-height: 0;
}

.chat__empty {
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 16px;
	color: var(--lares-text-muted);
}

.chat__status {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 4px 14px;
	border-top: 1px solid var(--lares-border);
	color: var(--lares-text-muted);
	font-size: 11.5px;
}

.chat__branches {
	max-height: 34vh;
	overflow-y: auto;
	border-bottom: 1px solid var(--lares-border);
	background: var(--lares-surface);
}

.chat__cwd {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-family: var(--lares-mono);
}
</style>
