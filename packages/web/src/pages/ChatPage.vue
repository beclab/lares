<template>
	<q-page class="column" style="height: calc(100vh - 50px)">
		<q-banner v-if="session.error" dense class="bg-negative text-white">
			{{ session.error }}
			<template #action>
				<q-btn flat dense label="Dismiss" @click="session.error = null" />
			</template>
		</q-banner>

		<div v-if="!session.sessionId" class="col column flex-center text-grey-6">
			<q-icon name="forum" size="64px" />
			<div class="q-mt-md">Pick a session or start a new one.</div>
			<q-btn
				class="q-mt-md"
				color="primary"
				icon="add"
				label="New session"
				:disable="!app.config"
				@click="startSession"
			/>
		</div>

		<template v-else>
			<div class="col" style="min-height: 0">
				<MessageList :messages="session.messages" />
			</div>
			<q-separator />
			<div class="row items-center q-px-md q-pt-xs text-caption text-grey-6">
				<span>{{ session.cwd }}</span>
				<q-space />
				<span v-if="contextLabel">{{ contextLabel }}</span>
				<q-icon
					class="q-ml-sm"
					:name="session.connected ? 'wifi' : 'wifi_off'"
					:color="session.connected ? 'positive' : 'grey'"
				/>
			</div>
			<ChatInput :streaming="session.isStreaming" @submit="onSubmit" @abort="onAbort" />
		</template>
	</q-page>
</template>

<script setup lang="ts">
import { computed, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ChatInput from "../components/ChatInput.vue";
import MessageList from "../components/MessageList.vue";
import { useAppStore } from "../stores/app-store";
import { useSessionStore } from "../stores/session-store";

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const session = useSessionStore();

const contextLabel = computed(() => {
	const usage = session.state?.contextUsage;
	if (!usage || usage.percent === null) return "";
	return `context ${usage.percent.toFixed(0)}%`;
});

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
	const cwd = app.config?.workspace;
	if (!cwd) return;
	await session.startSession(cwd);
	await app.loadSessions();
	await router.push({ name: "session", params: { id: session.sessionId } });
}

async function onSubmit(text: string): Promise<void> {
	await session.sendPrompt(text);
	await app.loadSessions();
}

async function onAbort(): Promise<void> {
	await session.send({ type: "abort" });
}
</script>
