<script setup lang="ts">
import { computed } from "vue";
import { parseDiff } from "../lib/messages";

const props = defineProps<{ patch: string }>();

const lines = computed(() => parseDiff(props.patch));
const stats = computed(() => ({
	added: lines.value.filter((line) => line.kind === "add").length,
	removed: lines.value.filter((line) => line.kind === "del").length,
}));
</script>

<template>
	<div class="diff">
		<div class="diff__bar">
			<span class="diff__added">+{{ stats.added }}</span>
			<span class="diff__removed">-{{ stats.removed }}</span>
		</div>
		<pre class="diff__body"><code><span
			v-for="(line, index) in lines"
			:key="index"
			:class="`diff__line diff__line--${line.kind}`"
		>{{ line.text }}
</span></code></pre>
	</div>
</template>

<style scoped lang="scss">
.diff {
	border: 1px solid var(--lares-border);
	border-radius: 6px;
	overflow: hidden;
}

.diff__bar {
	display: flex;
	gap: 10px;
	padding: 3px 10px;
	background: var(--lares-surface-2);
	border-bottom: 1px solid var(--lares-border);
	font-size: 11px;
	font-family: var(--lares-mono);
}

.diff__added {
	color: var(--lares-diff-add-text);
}

.diff__removed {
	color: var(--lares-diff-del-text);
}

.diff__body {
	margin: 0;
	padding: 0;
	max-height: 420px;
	overflow: auto;
	font-family: var(--lares-mono);
	font-size: 12px;
	line-height: 1.5;
}

.diff__line {
	display: block;
	padding: 0 10px;
	white-space: pre-wrap;
	word-break: break-word;
}

.diff__line--add {
	background: var(--lares-diff-add-bg);
	color: var(--lares-diff-add-text);
}

.diff__line--del {
	background: var(--lares-diff-del-bg);
	color: var(--lares-diff-del-text);
}

.diff__line--meta {
	color: var(--lares-text-muted);
}
</style>
