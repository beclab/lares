<script setup lang="ts">
import { computed } from "vue";
import { renderMarkdown } from "../lib/markdown";
import CodeBlock from "./CodeBlock.vue";

const props = defineProps<{ source: string; streaming?: boolean }>();

const segments = computed(() => renderMarkdown(props.source));
</script>

<template>
	<div class="markdown-body">
		<template v-for="(segment, index) in segments" :key="index">
			<CodeBlock v-if="segment.kind === 'code'" :lang="segment.lang" :code="segment.code" :streaming="streaming" />
			<!-- eslint-disable-next-line vue/no-v-html -- sanitized in renderMarkdown -->
			<div v-else v-html="segment.html" />
		</template>
	</div>
</template>
