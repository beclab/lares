<script setup lang="ts">
import { ref, watch } from "vue";
import { highlight } from "../lib/markdown";

const props = defineProps<{ code: string; streaming?: boolean }>();

const showPreview = ref(false);
const svg = ref("");
const renderError = ref<string | null>(null);
const zoom = ref(100);

let renderToken = 0;

async function render(): Promise<void> {
	const token = ++renderToken;
	renderError.value = null;
	try {
		const { default: mermaid } = await import("mermaid");
		mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "dark" });
		const result = await mermaid.render(`mermaid-${token}`, props.code);
		if (token === renderToken) svg.value = result.svg;
	} catch (err) {
		if (token === renderToken) {
			svg.value = "";
			renderError.value = err instanceof Error ? err.message : String(err);
		}
	}
}

// Re-rendering every keystroke of a streaming diagram produces a flood of
// parse errors, so the preview only refreshes once the block is complete.
watch(
	() => [showPreview.value, props.code, props.streaming] as const,
	([visible, , streaming]) => {
		if (visible && !streaming) void render();
	},
	{ immediate: true },
);
</script>

<template>
	<div class="mermaid-block">
		<div class="mermaid-block__bar">
			<span class="mermaid-block__lang">mermaid</span>
			<q-btn
				dense
				flat
				size="sm"
				:disable="streaming"
				:label="showPreview ? 'Source' : 'Preview'"
				@click="showPreview = !showPreview"
			/>
			<template v-if="showPreview && svg">
				<q-btn dense flat size="sm" icon="zoom_out" @click="zoom = Math.max(50, zoom - 25)" />
				<span class="mermaid-block__zoom">{{ zoom }}%</span>
				<q-btn dense flat size="sm" icon="zoom_in" @click="zoom = Math.min(300, zoom + 25)" />
			</template>
		</div>

		<div v-if="showPreview && svg" class="mermaid-block__canvas">
			<!-- eslint-disable-next-line vue/no-v-html -- mermaid output, rendered with securityLevel strict -->
			<div :style="{ zoom: `${zoom}%` }" v-html="svg" />
		</div>
		<div v-else-if="showPreview && renderError" class="mermaid-block__error">{{ renderError }}</div>
		<pre v-else class="mermaid-block__source hljs"><code v-html="highlight(code, 'mermaid')" /></pre>
	</div>
</template>

<style scoped lang="scss">
.mermaid-block {
	border: 1px solid var(--lares-border);
	border-radius: 6px;
	overflow: hidden;
	margin: 8px 0;
}

.mermaid-block__bar {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 2px 6px 2px 10px;
	background: var(--lares-surface-2);
	border-bottom: 1px solid var(--lares-border);
	font-size: 11px;
	font-family: var(--lares-mono);
}

.mermaid-block__lang {
	margin-right: auto;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	opacity: 0.75;
}

.mermaid-block__zoom {
	min-width: 38px;
	text-align: center;
	opacity: 0.7;
}

.mermaid-block__canvas {
	padding: 12px;
	overflow: auto;
	background: var(--lares-surface);
}

.mermaid-block__error {
	padding: 10px 12px;
	color: var(--lares-danger);
	font-family: var(--lares-mono);
	font-size: 12px;
}

.mermaid-block__source {
	margin: 0;
	padding: 10px 12px;
	overflow-x: auto;
	font-family: var(--lares-mono);
	font-size: 12.5px;
	line-height: 1.55;
}
</style>
