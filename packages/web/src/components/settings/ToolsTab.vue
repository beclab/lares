<script setup lang="ts">
import type { ToolInfo } from "@lares/shared";
import { onMounted, ref } from "vue";
import { useSessionStore } from "../../stores/session-store";

const session = useSessionStore();

/** What pi returns from get_tools, before the active set is folded in. */
interface RawTool {
	name: string;
	description: string;
	sourceInfo?: { source?: string };
}

const tools = ref<ToolInfo[]>([]);
const loading = ref(false);

async function load(): Promise<void> {
	if (!session.sessionId) return;
	loading.value = true;
	try {
		const all = (await session.send({ type: "get_tools" })) as RawTool[] | null;
		const active = new Set(session.state?.activeToolNames ?? []);
		tools.value = (all ?? []).map((tool) => ({
			name: tool.name,
			description: tool.description,
			active: active.has(tool.name),
			source: tool.sourceInfo?.source ?? "built-in",
		}));
	} finally {
		loading.value = false;
	}
}

onMounted(load);

/**
 * Tool selection is a property of the running session, not a stored setting, so
 * a toggle sends the whole new set and pi answers with fresh state.
 */
async function toggle(name: string, active: boolean): Promise<void> {
	const next = tools.value.filter((tool) => (tool.name === name ? active : tool.active)).map((tool) => tool.name);
	await session.send({ type: "set_tools", toolNames: next });
	await session.refreshState();
	await load();
}
</script>

<template>
	<div class="tools">
		<q-banner v-if="!session.sessionId" dense class="bg-grey-9 text-white">
			Open a session to change which tools it may use.
		</q-banner>

		<template v-else>
			<p class="tools__hint">
				Switching a tool off removes it from this session's prompt. New sessions start with pi's full set again.
			</p>

			<q-list bordered separator>
				<q-item v-for="tool in tools" :key="tool.name">
					<q-item-section>
						<q-item-label class="tools__name">{{ tool.name }}</q-item-label>
						<q-item-label caption lines="2">{{ tool.description }}</q-item-label>
					</q-item-section>
					<q-item-section side>
						<q-toggle :model-value="tool.active" @update:model-value="toggle(tool.name, $event)" />
					</q-item-section>
				</q-item>
			</q-list>

			<q-inner-loading :showing="loading" />
		</template>
	</div>
</template>

<style scoped lang="scss">
.tools {
	position: relative;
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.tools__hint {
	margin: 0;
	font-size: 12.5px;
	color: var(--lares-muted);
}

.tools__name {
	font-family: var(--lares-mono);
	font-size: 13px;
}
</style>
