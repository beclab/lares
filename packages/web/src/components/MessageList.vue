<template>
	<div ref="scroller" class="lares-chat-scroll q-pa-md">
		<div v-if="messages.length === 0" class="text-grey-6 text-center q-mt-xl">
			No messages yet. Say something to get started.
		</div>
		<MessageItem v-for="(message, index) in messages" :key="index" :message="message" />
	</div>
</template>

<script setup lang="ts">
import type { AgentMessage } from "@lares/shared";
import { nextTick, ref, watch } from "vue";
import MessageItem from "./MessageItem.vue";

const props = defineProps<{ messages: AgentMessage[] }>();

const scroller = ref<HTMLElement | null>(null);

/** Stay pinned to the bottom unless the user scrolled up to read history. */
watch(
	() => props.messages.length,
	async () => {
		const element = scroller.value;
		if (!element) return;
		const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
		if (distanceFromBottom > 200) return;
		await nextTick();
		element.scrollTop = element.scrollHeight;
	},
);
</script>
