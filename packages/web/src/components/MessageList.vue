<script setup lang="ts">
import type { AgentMessage, ToolResultMessage } from "@lares/shared";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { AgentPhase } from "../stores/session-store";
import MessageItem from "./MessageItem.vue";

const props = defineProps<{
	messages: AgentMessage[];
	streamingMessage: AgentMessage | null;
	toolResults: Map<string, ToolResultMessage>;
	runningToolIds: Set<string>;
	phase: AgentPhase;
	agentRunning: boolean;
}>();

const scroller = ref<HTMLElement | null>(null);
const pinnedToBottom = ref(true);

const phaseLabel = computed(() => {
	switch (props.phase.kind) {
		case "waiting_model":
			return "Thinking…";
		case "running_tools":
			return props.phase.tools.length > 1 ? `Running ${props.phase.tools.length} tools…` : "Running a tool…";
		case "compacting":
			return "Compacting the conversation…";
		default:
			return null;
	}
});

const showPhase = computed(() => props.agentRunning && !props.streamingMessage && phaseLabel.value !== null);

function onScroll(): void {
	const element = scroller.value;
	if (!element) return;
	// Following the tail is the default, but scrolling up to read must not be
	// yanked back by the next token.
	pinnedToBottom.value = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
}

function scrollToBottom(smooth = false): void {
	const element = scroller.value;
	if (!element) return;
	element.scrollTo({ top: element.scrollHeight, behavior: smooth ? "smooth" : "auto" });
}

watch(
	() => [props.messages.length, props.streamingMessage] as const,
	async () => {
		if (!pinnedToBottom.value) return;
		await nextTick();
		scrollToBottom();
	},
);

onMounted(() => scrollToBottom());

defineExpose({ scrollToBottom });
</script>

<template>
	<div ref="scroller" class="message-list" @scroll="onScroll">
		<div class="message-list__inner">
			<MessageItem
				v-for="(message, index) in messages"
				:key="index"
				:message="message"
				:tool-results="toolResults"
				:running-tool-ids="runningToolIds"
			/>

			<MessageItem
				v-if="streamingMessage"
				:message="streamingMessage"
				:tool-results="toolResults"
				:running-tool-ids="runningToolIds"
				streaming
			/>

			<div v-if="showPhase" class="message-list__phase">{{ phaseLabel }}</div>
		</div>

		<q-btn
			v-if="!pinnedToBottom"
			round
			dense
			class="message-list__jump"
			icon="arrow_downward"
			@click="scrollToBottom(true)"
		/>
	</div>
</template>

<style scoped lang="scss">
.message-list {
	position: relative;
	flex: 1;
	min-height: 0;
	overflow-y: auto;
}

.message-list__inner {
	max-width: 900px;
	margin: 0 auto;
	padding: 16px 16px 24px;
}

.message-list__phase {
	padding: 4px 0;
	color: var(--lares-text-muted);
	font-size: 12.5px;
	animation: phase-pulse 1.5s ease-in-out infinite;
}

.message-list__jump {
	position: sticky;
	bottom: 12px;
	left: 100%;
	margin-right: 16px;
	background: var(--lares-surface-2);
}

@keyframes phase-pulse {
	0%,
	100% {
		opacity: 1;
	}
	50% {
		opacity: 0.45;
	}
}
</style>
