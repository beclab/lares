<script setup lang="ts">
import type { FileContent, FileMeta, GitDiffResponse } from "@lares/shared";
import { computed, ref, watch } from "vue";
import { api } from "../lib/api";
import { highlight } from "../lib/markdown";
import DiffView from "./DiffView.vue";
import MarkdownBody from "./MarkdownBody.vue";

const props = defineProps<{ path: string | null }>();
const emit = defineEmits<{ close: []; mention: [path: string] }>();

type Tab = "source" | "preview" | "diff";

const meta = ref<FileMeta | null>(null);
const text = ref<string | null>(null);
const docxHtml = ref<string | null>(null);
const diff = ref<GitDiffResponse | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const tab = ref<Tab>("source");

const rendersPreview = computed(() => meta.value?.previewKind === "markdown" || meta.value?.previewKind === "docx");
const hasDiff = computed(() => diff.value?.supported === true);
const highlighted = computed(() => (text.value === null ? "" : highlight(text.value, meta.value?.language ?? "")));
const rawUrl = computed(() => (props.path ? api.rawUrl(props.path) : ""));

/** Notebooks are JSON on disk; showing the source beats showing nothing. */
const isTextual = computed(() => {
	const kind = meta.value?.previewKind;
	return kind === "text" || kind === "markdown" || kind === "notebook";
});

async function load(path: string): Promise<void> {
	loading.value = true;
	error.value = null;
	text.value = null;
	docxHtml.value = null;
	diff.value = null;

	try {
		const info = await api.fileMeta(path);
		meta.value = info;

		if (info.tooLarge) {
			error.value = "This file is binary or larger than 512 KB, so only download is available.";
		} else if (info.previewKind === "text" || info.previewKind === "markdown" || info.previewKind === "notebook") {
			text.value = ((await api.readFile(path)) as FileContent).content;
		} else if (info.previewKind === "docx") {
			docxHtml.value = (await api.docxHtml(path)).html;
		}

		tab.value = info.previewKind === "markdown" || info.previewKind === "docx" ? "preview" : "source";

		// A diff only exists for files git already knows about, so a failure here
		// is expected outside repositories and should not blank the viewer.
		diff.value = await api.gitDiff(path).catch(() => null);
		if (diff.value?.supported) tab.value = "diff";
	} catch (err) {
		error.value = err instanceof Error ? err.message : String(err);
	} finally {
		loading.value = false;
	}
}

watch(
	() => props.path,
	(path) => {
		if (path) void load(path);
	},
	{ immediate: true },
);
</script>

<template>
	<div v-if="path" class="viewer">
		<div class="viewer__bar">
			<span class="viewer__path">{{ path }}</span>
			<q-btn dense flat size="sm" icon="alternate_email" @click="emit('mention', path)">
				<q-tooltip>Mention in the prompt</q-tooltip>
			</q-btn>
			<q-btn dense flat size="sm" icon="download" :href="api.rawUrl(path, true)" target="_blank">
				<q-tooltip>Download</q-tooltip>
			</q-btn>
			<q-btn dense flat size="sm" icon="close" @click="emit('close')" />
		</div>

		<q-tabs v-if="rendersPreview || hasDiff" v-model="tab" dense align="left" class="viewer__tabs" no-caps>
			<q-tab v-if="hasDiff" name="diff" label="Diff" />
			<q-tab v-if="rendersPreview" name="preview" label="Preview" />
			<q-tab v-if="isTextual" name="source" label="Source" />
		</q-tabs>

		<div class="viewer__body">
			<q-inner-loading :showing="loading" />

			<q-banner v-if="error" dense class="bg-grey-9 text-white">
				{{ error }}
				<template #action>
					<q-btn flat dense label="Download" :href="api.rawUrl(path, true)" target="_blank" />
				</template>
			</q-banner>

			<template v-else-if="meta">
				<DiffView v-if="tab === 'diff' && diff?.patch" :patch="diff.patch" />

				<MarkdownBody
					v-else-if="tab === 'preview' && meta.previewKind === 'markdown' && text !== null"
					:source="text"
				/>

				<!-- eslint-disable-next-line vue/no-v-html -- produced by mammoth from a workspace file -->
				<div v-else-if="tab === 'preview' && docxHtml !== null" class="markdown-body" v-html="docxHtml" />

				<pre
					v-else-if="tab === 'source' && text !== null"
					class="viewer__source hljs"
				><code v-html="highlighted" /></pre>

				<img v-else-if="meta.previewKind === 'image'" class="viewer__image" :src="rawUrl" :alt="path" />

				<!-- eslint-disable-next-line vuejs-accessibility/media-has-caption -- workspace media has no track -->
				<audio v-else-if="meta.previewKind === 'audio'" class="viewer__media" controls :src="rawUrl" />

				<!-- eslint-disable-next-line vuejs-accessibility/media-has-caption -- workspace media has no track -->
				<video v-else-if="meta.previewKind === 'video'" class="viewer__media" controls :src="rawUrl" />

				<iframe v-else-if="meta.previewKind === 'pdf'" class="viewer__frame" :src="rawUrl" :title="path" />
			</template>
		</div>
	</div>
</template>

<style scoped lang="scss">
.viewer {
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 0;
}

.viewer__bar {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 4px 6px 4px 10px;
	border-bottom: 1px solid var(--lares-border);
}

.viewer__path {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	direction: rtl;
	text-align: left;
	font-family: var(--lares-mono);
	font-size: 12px;
}

.viewer__tabs {
	border-bottom: 1px solid var(--lares-border);
	min-height: 32px;
}

.viewer__body {
	position: relative;
	flex: 1;
	min-height: 0;
	overflow: auto;
	padding: 8px 10px;
}

.viewer__source {
	margin: 0;
	font-family: var(--lares-mono);
	font-size: 12.5px;
	line-height: 1.55;
	white-space: pre;
	background: transparent;
}

.viewer__image {
	max-width: 100%;
	height: auto;
}

.viewer__media {
	width: 100%;
}

.viewer__frame {
	width: 100%;
	height: 100%;
	min-height: 70vh;
	border: 0;
}
</style>
