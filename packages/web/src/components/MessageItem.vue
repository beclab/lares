<script setup lang="ts">
import type { AgentMessage, AssistantMessage, ToolResultMessage } from "@lares/shared";
import { computed, ref } from "vue";
import { formatCost, formatTokens, imageDataUrl, isEmptyThinking, userContent } from "../lib/messages";
import MarkdownBody from "./MarkdownBody.vue";
import ThinkingBlock from "./ThinkingBlock.vue";
import ToolCallBlock from "./ToolCallBlock.vue";

const props = defineProps<{
	message: AgentMessage;
	toolResults: Map<string, ToolResultMessage>;
	runningToolIds?: Set<string>;
	streaming?: boolean;
}>();

const copied = ref(false);

const user = computed(() => (props.message.role === "user" ? userContent(props.message.content) : null));

const assistant = computed(() => (props.message.role === "assistant" ? (props.message as AssistantMessage) : null));

const assistantBlocks = computed(() => (assistant.value?.content ?? []).filter((block) => !isEmptyThinking(block)));

const usage = computed(() => {
	const value = assistant.value?.usage;
	if (!value || props.streaming) return null;
	return {
		input: formatTokens(value.input),
		output: formatTokens(value.output),
		cache: formatTokens(value.cacheRead + value.cacheWrite),
		cost: formatCost(value.cost.total),
	};
});

const copyText = computed(() => {
	if (user.value) return user.value.text;
	return assistantBlocks.value
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n\n");
});

async function copy(): Promise<void> {
	await navigator.clipboard.writeText(copyText.value);
	copied.value = true;
	setTimeout(() => {
		copied.value = false;
	}, 1500);
}
</script>

<template>
	<div class="message" :class="`message--${message.role}`">
		<div v-if="user" class="message__user">
			<div class="message__user-body">
				<MarkdownBody :source="user.text" />
				<div v-if="user.images.length > 0" class="message__images">
					<img v-for="(image, index) in user.images" :key="index" :src="imageDataUrl(image)" alt="attachment" />
				</div>
			</div>
			<q-btn
				dense
				flat
				size="sm"
				class="message__copy"
				:icon="copied ? 'check' : 'content_copy'"
				@click="copy"
			/>
		</div>

		<template v-else-if="assistant">
			<template v-for="(block, index) in assistantBlocks" :key="index">
				<MarkdownBody v-if="block.type === 'text'" :source="block.text" :streaming="streaming" />
				<ThinkingBlock v-else-if="block.type === 'thinking'" :block="block" :streaming="streaming" />
				<ToolCallBlock
					v-else-if="block.type === 'toolCall'"
					:call="block"
					:result="toolResults.get(block.id)"
					:running="runningToolIds?.has(block.id)"
				/>
			</template>

			<div v-if="assistant.errorMessage" class="message__error">{{ assistant.errorMessage }}</div>

			<div v-if="usage" class="message__footer">
				<span>{{ usage.input }} in</span>
				<span>{{ usage.output }} out</span>
				<span v-if="usage.cache !== '0'">{{ usage.cache }} cached</span>
				<span>{{ usage.cost }}</span>
				<q-btn dense flat size="sm" :icon="copied ? 'check' : 'content_copy'" @click="copy" />
			</div>
		</template>

		<div v-else-if="message.role === 'compactionSummary'" class="message__compaction">
			<div class="message__compaction-title">
				Compacted {{ formatTokens(message.tokensBefore) }} tokens into a summary
			</div>
			<MarkdownBody :source="message.summary" />
		</div>

		<div v-else-if="message.role === 'branchSummary'" class="message__compaction">
			<div class="message__compaction-title">Summary of a branch this conversation returned from</div>
			<MarkdownBody :source="message.summary" />
		</div>

		<div v-else-if="message.role === 'bashExecution'" class="message__bash">
			<div class="message__bash-command">$ {{ message.command }}</div>
			<pre v-if="message.output" class="message__bash-output">{{ message.output }}</pre>
			<div v-if="message.exitCode" class="message__bash-exit">exit {{ message.exitCode }}</div>
		</div>

		<div v-else-if="message.role === 'custom' && message.display" class="message__custom">
			<MarkdownBody :source="userContent(message.content).text" />
		</div>
	</div>
</template>

<style scoped lang="scss">
.message {
	margin-bottom: 14px;
}

.message__user {
	display: flex;
	align-items: flex-start;
	gap: 6px;

	.message__copy {
		opacity: 0;
		transition: opacity 0.15s;
	}

	&:hover .message__copy {
		opacity: 0.6;
	}
}

.message__user-body {
	flex: 1;
	min-width: 0;
	padding: 8px 12px;
	border-radius: 10px;
	background: var(--lares-surface-2);
}

.message__images {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin-top: 6px;

	img {
		max-width: 240px;
		max-height: 240px;
		border-radius: 6px;
	}
}

.message__error {
	margin-top: 6px;
	padding: 8px 10px;
	border: 1px solid var(--lares-danger);
	border-radius: 6px;
	color: var(--lares-danger);
	font-size: 12.5px;
}

.message__footer {
	display: flex;
	align-items: center;
	gap: 10px;
	margin-top: 6px;
	color: var(--lares-text-muted);
	font-size: 11px;
	font-family: var(--lares-mono);
	opacity: 0;
	transition: opacity 0.15s;
}

.message:hover .message__footer {
	opacity: 0.8;
}

.message__compaction {
	padding: 8px 12px;
	border-left: 2px solid var(--lares-accent);
	background: var(--lares-surface-2);
	border-radius: 0 6px 6px 0;
}

.message__compaction-title {
	margin-bottom: 4px;
	color: var(--lares-text-muted);
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: 0.04em;
}

.message__bash {
	border-left: 2px solid var(--lares-border);
	padding-left: 8px;
	font-family: var(--lares-mono);
	font-size: 12.5px;
}

.message__bash-command {
	font-weight: 600;
}

.message__bash-output {
	margin: 4px 0 0;
	padding: 8px 10px;
	max-height: 400px;
	overflow: auto;
	border-radius: 6px;
	background: var(--lares-surface-2);
	white-space: pre-wrap;
	word-break: break-word;
}

.message__bash-exit {
	margin-top: 2px;
	color: var(--lares-danger);
	font-size: 11px;
}

.message__custom {
	color: var(--lares-text-muted);
	font-size: 12.5px;
}
</style>
