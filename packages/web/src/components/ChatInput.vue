<script setup lang="ts">
import type { ImageAttachment } from "@lares/shared";
import { computed, nextTick, ref, watch } from "vue";
import { api } from "../lib/api";
import { type PendingImage, imagesFromDataTransfer, MAX_IMAGES, readImage, releaseImage } from "../lib/images";
import { applyMention, mentionAt, type MentionToken } from "../lib/mentions";
import type { SubmitIntent } from "../lib/messages";
import { useFilesStore } from "../stores/files-store";

const props = defineProps<{
	busy: boolean;
	compacting: boolean;
	queued: { steering: string[]; followUp: string[] };
	disabled?: boolean;
}>();

const emit = defineEmits<{
	submit: [text: string, images: ImageAttachment[], intent: SubmitIntent];
	bash: [command: string, excludeFromContext: boolean];
	abort: [];
	compact: [];
	recallQueue: [];
}>();

const files = useFilesStore();

const text = ref("");
const images = ref<PendingImage[]>([]);
const attachError = ref<string | null>(null);
const dragging = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const inputRef = ref<{ getNativeElement: () => HTMLTextAreaElement } | null>(null);

const mentionToken = ref<MentionToken | null>(null);
const mentionMatches = ref<string[]>([]);
const mentionIndex = ref(0);
const mentionOpen = computed(() => mentionToken.value !== null && mentionMatches.value.length > 0);

const trimmed = computed(() => text.value.trim());
const hasText = computed(() => trimmed.value.length > 0);
const isBashCommand = computed(() => trimmed.value.startsWith("!"));
const canAttach = computed(() => !props.busy && images.value.length < MAX_IMAGES);
// pi only accepts text into the steering and follow-up queues, so attachments
// have to wait for an idle turn.
const canQueue = computed(() => hasText.value && images.value.length === 0);
const totalQueued = computed(() => props.queued.steering.length + props.queued.followUp.length);

const placeholder = computed(() => {
	if (props.busy) return "Steer the current turn, or queue a follow-up";
	return "Ask pi to do something. Prefix with ! to run a shell command.";
});

function textarea(): HTMLTextAreaElement | null {
	return inputRef.value?.getNativeElement() ?? null;
}

let mentionRequest = 0;

/**
 * The picker follows the caret rather than a keystroke, so moving the cursor
 * back into an existing `@path` reopens it on the same token.
 */
async function refreshMentions(): Promise<void> {
	const element = textarea();
	const token = element ? mentionAt(text.value, element.selectionStart) : null;
	mentionToken.value = token;

	if (!token) {
		mentionMatches.value = [];
		return;
	}

	const request = ++mentionRequest;
	try {
		const { files } = await api.fileIndex(token.query);
		// A slower earlier request must not overwrite a newer result.
		if (request !== mentionRequest) return;
		mentionMatches.value = files;
		mentionIndex.value = 0;
	} catch {
		if (request === mentionRequest) mentionMatches.value = [];
	}
}

function closeMentions(): void {
	mentionToken.value = null;
	mentionMatches.value = [];
}

async function chooseMention(path: string): Promise<void> {
	const token = mentionToken.value;
	if (!token) return;

	const isDir = path.endsWith("/");
	const result = applyMention(text.value, token, isDir ? path.slice(0, -1) : path, isDir);
	text.value = result.text;
	closeMentions();

	await nextTick();
	const element = textarea();
	element?.focus();
	element?.setSelectionRange(result.caret, result.caret);
}

/** Appends a path the file tree or the viewer asked to reference. */
async function insertMention(path: string): Promise<void> {
	const separator = text.value.length === 0 || /\s$/.test(text.value) ? "" : " ";
	const quoted = /\s/.test(path) ? `@"${path}"` : `@${path}`;
	text.value = `${text.value}${separator}${quoted} `;
	closeMentions();

	await nextTick();
	const element = textarea();
	element?.focus();
	element?.setSelectionRange(text.value.length, text.value.length);
}

watch(
	() => files.pendingMention,
	(path) => {
		if (!path) return;
		files.clearMention();
		void insertMention(path);
	},
);

watch(text, () => {
	void refreshMentions();
});

async function attach(files: File[]): Promise<void> {
	attachError.value = null;
	for (const file of files.slice(0, MAX_IMAGES - images.value.length)) {
		try {
			images.value = [...images.value, await readImage(file)];
		} catch (err) {
			attachError.value = err instanceof Error ? err.message : String(err);
		}
	}
}

function removeImage(index: number): void {
	const image = images.value[index];
	if (image) releaseImage(image);
	images.value = images.value.filter((_, i) => i !== index);
}

function clearAttachments(): void {
	for (const image of images.value) releaseImage(image);
	images.value = [];
}

function submit(intent: SubmitIntent): void {
	if (!hasText.value) return;

	if (isBashCommand.value && !props.busy) {
		const excludeFromContext = trimmed.value.startsWith("!!");
		const command = trimmed.value.replace(/^!!?/, "").trim();
		if (command) emit("bash", command, excludeFromContext);
		text.value = "";
		return;
	}

	if (props.busy && !canQueue.value) return;

	emit(
		"submit",
		trimmed.value,
		images.value.map(({ type, data, mimeType }) => ({ type, data, mimeType })),
		intent,
	);
	text.value = "";
	clearAttachments();
}

function onKeydown(event: KeyboardEvent): void {
	if (mentionOpen.value) {
		const count = mentionMatches.value.length;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			mentionIndex.value = (mentionIndex.value + 1) % count;
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			mentionIndex.value = (mentionIndex.value - 1 + count) % count;
			return;
		}
		if (event.key === "Enter" || event.key === "Tab") {
			const choice = mentionMatches.value[mentionIndex.value];
			if (choice) {
				event.preventDefault();
				void chooseMention(choice);
				return;
			}
		}
		if (event.key === "Escape") {
			event.preventDefault();
			closeMentions();
			return;
		}
	}

	if (event.key === "Escape" && props.busy) {
		event.preventDefault();
		emit("abort");
		return;
	}
	if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
	event.preventDefault();
	submit("auto");
}

async function onPaste(event: ClipboardEvent): Promise<void> {
	const files = [...(event.clipboardData?.items ?? [])]
		.filter((item) => item.kind === "file" && item.type.startsWith("image/"))
		.map((item) => item.getAsFile())
		.filter((file): file is File => file !== null);
	if (files.length === 0) return;
	event.preventDefault();
	await attach(files);
}

async function onDrop(event: DragEvent): Promise<void> {
	dragging.value = false;
	const files = imagesFromDataTransfer(event.dataTransfer);
	if (files.length === 0 || !canAttach.value) return;
	event.preventDefault();
	await attach(files);
}

async function onFilePicked(event: Event): Promise<void> {
	const input = event.target as HTMLInputElement;
	await attach([...(input.files ?? [])]);
	input.value = "";
}
</script>

<template>
	<div
		class="composer"
		:class="{ 'composer--busy': busy, 'composer--drag': dragging }"
		@dragover.prevent="dragging = canAttach"
		@dragleave="dragging = false"
		@drop.prevent="onDrop"
	>
		<div v-if="totalQueued > 0" class="composer__queue">
			<span class="composer__queue-label">
				{{ totalQueued }} queued
				<template v-if="queued.steering.length">· {{ queued.steering.length }} steering</template>
				<template v-if="queued.followUp.length">· {{ queued.followUp.length }} follow-up</template>
			</span>
			<q-btn dense flat size="sm" label="Recall" @click="emit('recallQueue')" />
		</div>

		<div v-if="images.length > 0" class="composer__images">
			<div v-for="(image, index) in images" :key="index" class="composer__image">
				<img :src="image.previewUrl" :alt="image.name" />
				<q-btn dense flat round size="xs" icon="close" @click="removeImage(index)" />
			</div>
		</div>

		<div v-if="attachError" class="composer__error">{{ attachError }}</div>

		<div class="composer__field">
			<ul v-if="mentionOpen" class="composer__mentions">
				<li
					v-for="(match, index) in mentionMatches"
					:key="match"
					class="composer__mention"
					:class="{ 'composer__mention--active': index === mentionIndex }"
					@mousedown.prevent="chooseMention(match)"
				>
					{{ match }}
				</li>
			</ul>

			<q-input
				ref="inputRef"
				v-model="text"
				type="textarea"
				autogrow
				outlined
				dense
				:disable="disabled"
				:placeholder="placeholder"
				input-class="composer__textarea"
				@keydown="onKeydown"
				@paste="onPaste"
				@click="refreshMentions"
				@blur="closeMentions"
			/>
		</div>

		<div class="composer__actions">
			<q-btn dense flat size="sm" icon="image" :disable="!canAttach" @click="fileInput?.click()">
				<q-tooltip>Attach images</q-tooltip>
			</q-btn>
			<q-btn dense flat size="sm" :loading="compacting" :disable="busy" icon="compress" @click="emit('compact')">
				<q-tooltip>Compact the conversation</q-tooltip>
			</q-btn>

			<div class="composer__spacer" />

			<template v-if="busy">
				<q-btn dense flat size="sm" label="Follow-up" :disable="!canQueue" @click="submit('followUp')" />
				<q-btn dense unelevated size="sm" color="primary" label="Steer" :disable="!canQueue" @click="submit('steer')" />
				<q-btn dense flat size="sm" color="negative" icon="stop" label="Stop" @click="emit('abort')" />
			</template>
			<q-btn
				v-else
				dense
				unelevated
				size="sm"
				color="primary"
				:icon="isBashCommand ? 'terminal' : 'send'"
				:label="isBashCommand ? 'Run' : 'Send'"
				:disable="disabled || !hasText"
				@click="submit('auto')"
			/>
		</div>

		<input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFilePicked" />
	</div>
</template>

<style scoped lang="scss">
.composer {
	padding: 8px 12px 10px;
	border-top: 1px solid var(--lares-border);
	background: var(--lares-surface);
}

.composer--busy :deep(.q-field__control) {
	border-color: var(--lares-accent);
}

.composer--drag {
	outline: 2px dashed var(--lares-accent);
	outline-offset: -4px;
}

.composer__queue {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 6px;
	color: var(--lares-text-muted);
	font-size: 12px;
}

.composer__queue-label {
	flex: 1;
}

.composer__images {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin-bottom: 6px;
}

.composer__image {
	position: relative;

	img {
		width: 64px;
		height: 64px;
		object-fit: cover;
		border: 1px solid var(--lares-border);
		border-radius: 6px;
	}

	.q-btn {
		position: absolute;
		top: -6px;
		right: -6px;
		background: var(--lares-surface-2);
	}
}

.composer__error {
	margin-bottom: 6px;
	color: var(--lares-danger);
	font-size: 12px;
}

.composer__field {
	position: relative;
}

.composer__mentions {
	position: absolute;
	bottom: calc(100% + 4px);
	left: 0;
	right: 0;
	z-index: 10;
	max-height: 240px;
	overflow-y: auto;
	margin: 0;
	padding: 4px 0;
	list-style: none;
	border: 1px solid var(--lares-border);
	border-radius: 6px;
	background: var(--lares-surface-2);
	box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
}

.composer__mention {
	padding: 3px 10px;
	cursor: pointer;
	font-family: var(--lares-mono);
	font-size: 12.5px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;

	&:hover {
		background: var(--lares-surface);
	}
}

.composer__mention--active {
	background: var(--lares-accent);
	color: #fff;
}

.composer__actions {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-top: 6px;
}

.composer__spacer {
	flex: 1;
}
</style>
