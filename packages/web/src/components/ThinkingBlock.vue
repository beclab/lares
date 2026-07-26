<script setup lang="ts">
import type { ThinkingContent } from "@lares/shared";
import { ref } from "vue";

defineProps<{ block: ThinkingContent; streaming?: boolean }>();

const expanded = ref(false);
</script>

<template>
	<div class="thinking">
		<button class="thinking__header" type="button" @click="expanded = !expanded">
			<q-icon :name="expanded ? 'expand_more' : 'chevron_right'" size="16px" />
			<span :class="{ 'thinking__label--live': streaming }">Thinking</span>
			<span v-if="block.redacted" class="thinking__redacted">redacted</span>
		</button>
		<pre v-if="expanded" class="thinking__body">{{ block.thinking }}</pre>
	</div>
</template>

<style scoped lang="scss">
.thinking {
	margin: 6px 0;
}

.thinking__header {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 2px 0;
	border: none;
	background: none;
	color: var(--lares-text-muted);
	font-size: 12px;
	font-family: inherit;
	cursor: pointer;
}

.thinking__label--live {
	animation: thinking-pulse 1.5s ease-in-out infinite;
}

.thinking__redacted {
	padding: 0 5px;
	border-radius: 3px;
	background: var(--lares-surface-2);
	font-size: 10px;
	text-transform: uppercase;
}

.thinking__body {
	margin: 4px 0 0 20px;
	padding: 8px 10px;
	border-left: 2px solid var(--lares-border);
	color: var(--lares-text-muted);
	font-size: 12.5px;
	line-height: 1.55;
	white-space: pre-wrap;
	word-break: break-word;
}

@keyframes thinking-pulse {
	0%,
	100% {
		opacity: 1;
	}
	50% {
		opacity: 0.4;
	}
}
</style>
