<template>
	<div class="q-mb-md">
		<div class="row items-center q-gutter-xs q-mb-xs text-caption text-grey-6">
			<q-icon :name="roleIcon" size="16px" />
			<span>{{ roleLabel }}</span>
		</div>

		<template v-if="message.role === 'user'">
			<div class="lares-message">{{ userText }}</div>
		</template>

		<template v-else-if="message.role === 'assistant'">
			<div v-for="(block, index) in assistantBlocks" :key="index">
				<div v-if="block.type === 'text'" class="lares-message">{{ block.text }}</div>
				<q-expansion-item
					v-else-if="block.type === 'thinking'"
					dense
					icon="psychology"
					label="Thinking"
					header-class="text-grey-6"
				>
					<div class="lares-message lares-mono q-pa-sm">{{ block.thinking }}</div>
				</q-expansion-item>
				<q-expansion-item
					v-else
					dense
					icon="build"
					:label="block.name"
					:caption="toolCaption(block)"
					header-class="text-primary"
				>
					<pre class="lares-mono q-pa-sm">{{ formatJson(block.arguments) }}</pre>
				</q-expansion-item>
			</div>
			<div v-if="message.errorMessage" class="text-negative lares-message">{{ message.errorMessage }}</div>
		</template>

		<template v-else-if="message.role === 'toolResult'">
			<q-expansion-item
				dense
				:icon="message.isError ? 'error_outline' : 'check_circle_outline'"
				:label="message.toolName"
				:header-class="message.isError ? 'text-negative' : 'text-grey-7'"
			>
				<div class="lares-message lares-mono q-pa-sm">{{ toolResultText }}</div>
			</q-expansion-item>
		</template>

		<template v-else>
			<pre class="lares-mono">{{ formatJson(message) }}</pre>
		</template>
	</div>
</template>

<script setup lang="ts">
import type { AgentMessage, AssistantMessage } from "@lares/shared";
import { computed } from "vue";

const props = defineProps<{ message: AgentMessage }>();

type AssistantBlock = AssistantMessage["content"][number];

const roleLabel = computed(() => {
	switch (props.message.role) {
		case "user":
			return "You";
		case "assistant":
			return "Assistant";
		case "toolResult":
			return "Tool result";
		default:
			return props.message.role;
	}
});

const roleIcon = computed(() => {
	switch (props.message.role) {
		case "user":
			return "person";
		case "assistant":
			return "smart_toy";
		case "toolResult":
			return "terminal";
		default:
			return "notes";
	}
});

const userText = computed(() => {
	if (props.message.role !== "user") return "";
	const content = props.message.content;
	if (typeof content === "string") return content;
	return content.map((part) => (part.type === "text" ? part.text : "[image]")).join("\n");
});

const assistantBlocks = computed<AssistantBlock[]>(() =>
	props.message.role === "assistant" ? props.message.content : [],
);

const toolResultText = computed(() => {
	if (props.message.role !== "toolResult") return "";
	return props.message.content.map((part) => (part.type === "text" ? part.text : "[image]")).join("\n");
});

function toolCaption(block: AssistantBlock): string {
	return block.type === "toolCall" ? block.id : "";
}

function formatJson(value: unknown): string {
	return JSON.stringify(value, null, 2);
}
</script>
