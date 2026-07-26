<script setup lang="ts">
import type { ImageAttachment } from "@lares/shared";
import { computed, ref } from "vue";
import { type PendingImage, imagesFromDataTransfer, MAX_IMAGES, readImage, releaseImage } from "../lib/images";
import type { SubmitIntent } from "../lib/messages";

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

const text = ref("");
const images = ref<PendingImage[]>([]);
const attachError = ref<string | null>(null);
const dragging = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

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

		<q-input
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
		/>

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
