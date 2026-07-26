<script setup lang="ts">
import { computed, ref } from "vue";
import { highlight } from "../lib/markdown";
import MermaidBlock from "./MermaidBlock.vue";

const props = defineProps<{ lang: string; code: string; streaming?: boolean }>();

const copied = ref(false);
const isMermaid = computed(() => props.lang.toLowerCase() === "mermaid");
const html = computed(() => highlight(props.code, props.lang));
const lineCount = computed(() => props.code.replace(/\n$/, "").split("\n").length);

async function copy(): Promise<void> {
	await navigator.clipboard.writeText(props.code);
	copied.value = true;
	setTimeout(() => {
		copied.value = false;
	}, 1500);
}
</script>

<template>
	<MermaidBlock v-if="isMermaid" :code="code" :streaming="streaming" />
	<div v-else class="code-block">
		<div class="code-block__bar">
			<span class="code-block__lang">{{ lang || "text" }}</span>
			<span class="code-block__lines">{{ lineCount }} lines</span>
			<q-btn
				dense
				flat
				size="sm"
				:icon="copied ? 'check' : 'content_copy'"
				:label="copied ? 'Copied' : 'Copy'"
				@click="copy"
			/>
		</div>
		<pre class="code-block__body hljs"><code v-html="html" /></pre>
	</div>
</template>

<style scoped lang="scss">
.code-block {
	border: 1px solid var(--lares-border);
	border-radius: 6px;
	overflow: hidden;
	margin: 8px 0;
}

.code-block__bar {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 2px 4px 2px 10px;
	background: var(--lares-surface-2);
	border-bottom: 1px solid var(--lares-border);
	font-size: 11px;
	font-family: var(--lares-mono);
}

.code-block__lang {
	text-transform: uppercase;
	letter-spacing: 0.04em;
	opacity: 0.75;
}

.code-block__lines {
	margin-left: auto;
	opacity: 0.5;
}

.code-block__body {
	margin: 0;
	padding: 10px 12px;
	overflow-x: auto;
	font-family: var(--lares-mono);
	font-size: 12.5px;
	line-height: 1.55;
}
</style>
