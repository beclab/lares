<script setup lang="ts">
import type { ContextUsageInfo } from "@lares/shared";
import { computed } from "vue";
import { formatTokens } from "../lib/messages";

const props = defineProps<{ usage: ContextUsageInfo | null }>();

const percent = computed(() => props.usage?.percent ?? null);

const tone = computed(() => {
	const value = percent.value;
	if (value === null) return "neutral";
	if (value >= 90) return "danger";
	if (value >= 70) return "warn";
	return "neutral";
});
</script>

<template>
	<div v-if="usage" class="context" :class="`context--${tone}`">
		<span>{{ percent === null ? "—" : `${percent.toFixed(0)}%` }}</span>
		<span class="context__detail">
			{{ usage.tokens === null ? "—" : formatTokens(usage.tokens) }} / {{ formatTokens(usage.contextWindow) }}
		</span>
		<q-tooltip>Context window usage</q-tooltip>
	</div>
</template>

<style scoped lang="scss">
.context {
	display: flex;
	align-items: baseline;
	gap: 6px;
	font-family: var(--lares-mono);
	font-size: 11.5px;
}

.context__detail {
	opacity: 0.6;
}

.context--warn {
	color: var(--lares-warning);
}

.context--danger {
	color: var(--lares-danger);
}
</style>
