<script setup lang="ts">
import type { ToolCall, ToolResultMessage } from "@lares/shared";
import { computed, ref } from "vue";
import { extractPatch, imageDataUrl, toolPreview, toolResultImages, toolResultText } from "../lib/messages";
import DiffView from "./DiffView.vue";

const props = defineProps<{
	call: ToolCall;
	result?: ToolResultMessage | undefined;
	running?: boolean | undefined;
}>();

const expanded = ref(false);

const preview = computed(() => toolPreview(props.call.arguments ?? {}));
const patch = computed(() => extractPatch(props.result));
const resultText = computed(() => (props.result ? toolResultText(props.result) : ""));
const resultImages = computed(() => (props.result ? toolResultImages(props.result) : []));
const isError = computed(() => props.result?.isError === true);
const argsJson = computed(() => JSON.stringify(props.call.arguments ?? {}, null, 2));

const state = computed(() => {
	if (props.result) return isError.value ? "error" : "done";
	return props.running ? "running" : "pending";
});
</script>

<template>
	<div class="tool" :class="`tool--${state}`">
		<button class="tool__header" type="button" @click="expanded = !expanded">
			<q-icon :name="expanded ? 'expand_more' : 'chevron_right'" size="16px" />
			<span class="tool__name">{{ call.name }}</span>
			<span class="tool__preview">{{ preview }}</span>
			<q-spinner v-if="state === 'running'" size="12px" class="tool__spinner" />
			<q-icon v-else-if="state === 'error'" name="error_outline" size="14px" class="tool__status" />
			<q-icon v-else-if="state === 'done'" name="check" size="14px" class="tool__status" />
		</button>

		<div v-if="expanded" class="tool__body">
			<!-- A unified patch says everything the raw arguments would, and reads far better. -->
			<DiffView v-if="patch" :patch="patch" />
			<pre v-else class="tool__args">{{ argsJson }}</pre>

			<pre v-if="resultText" class="tool__result" :class="{ 'tool__result--error': isError }">{{ resultText }}</pre>
			<div v-else-if="result && resultImages.length === 0" class="tool__result tool__result--empty">(no output)</div>

			<div v-if="resultImages.length > 0" class="tool__images">
				<img v-for="(image, index) in resultImages" :key="index" :src="imageDataUrl(image)" alt="tool result" />
			</div>
		</div>
	</div>
</template>

<style scoped lang="scss">
.tool {
	margin: 4px 0;
	border-left: 2px solid var(--lares-border);
	padding-left: 8px;
}

.tool--error {
	border-left-color: var(--lares-danger);
}

.tool--done {
	border-left-color: var(--lares-success);
}

.tool--running {
	border-left-color: var(--lares-accent);
}

.tool__header {
	display: flex;
	align-items: center;
	gap: 6px;
	width: 100%;
	padding: 2px 0;
	border: none;
	background: none;
	color: inherit;
	font-family: inherit;
	font-size: 12.5px;
	text-align: left;
	cursor: pointer;
}

.tool__name {
	font-family: var(--lares-mono);
	font-weight: 600;
}

.tool__preview {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--lares-text-muted);
	font-family: var(--lares-mono);
}

.tool__spinner,
.tool__status {
	flex-shrink: 0;
	opacity: 0.7;
}

.tool__body {
	margin: 4px 0 8px;
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.tool__args,
.tool__result {
	margin: 0;
	padding: 8px 10px;
	max-height: 400px;
	overflow: auto;
	border: 1px solid var(--lares-border);
	border-radius: 6px;
	background: var(--lares-surface-2);
	font-family: var(--lares-mono);
	font-size: 12px;
	line-height: 1.5;
	white-space: pre-wrap;
	word-break: break-word;
}

.tool__result--error {
	border-color: var(--lares-danger);
	color: var(--lares-danger);
}

.tool__result--empty {
	color: var(--lares-text-muted);
	font-style: italic;
}

.tool__images {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;

	img {
		max-width: 320px;
		max-height: 320px;
		border: 1px solid var(--lares-border);
		border-radius: 6px;
	}
}
</style>
