<template>
	<div class="q-pa-sm">
		<q-input
			v-model="text"
			type="textarea"
			autogrow
			outlined
			dense
			:disable="disabled"
			:placeholder="placeholder"
			@keydown="onKeydown"
		>
			<template #after>
				<q-btn
					round
					dense
					flat
					:icon="streaming ? 'stop' : 'send'"
					:color="streaming ? 'negative' : 'primary'"
					:disable="disabled || (!streaming && text.trim().length === 0)"
					@click="streaming ? emit('abort') : submit()"
				/>
			</template>
		</q-input>
		<div class="text-caption text-grey-6 q-mt-xs">Enter to send, Shift+Enter for a new line</div>
	</div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{ disabled?: boolean; streaming?: boolean }>();
const emit = defineEmits<{ submit: [text: string]; abort: [] }>();

const text = ref("");

const placeholder = computed(() => (props.streaming ? "Queue a follow-up message" : "Ask pi to do something"));

function submit(): void {
	const value = text.value.trim();
	if (!value) return;
	text.value = "";
	emit("submit", value);
}

function onKeydown(event: KeyboardEvent): void {
	if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
	event.preventDefault();
	submit();
}
</script>
