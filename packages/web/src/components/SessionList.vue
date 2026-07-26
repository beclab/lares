<script setup lang="ts">
import type { SessionSummary } from "@lares/shared";
import { useQuasar } from "quasar";
import { api } from "../lib/api";
import { useAppStore } from "../stores/app-store";
import { useWorkspaceStore } from "../stores/workspace-store";

const props = defineProps<{ activeId: string | null }>();
const emit = defineEmits<{ open: [id: string]; deleted: [id: string] }>();

const app = useAppStore();
const workspace = useWorkspaceStore();
const quasar = useQuasar();

/**
 * Opening a session also points the app at that session's checkout, so the file
 * tree and the next new session follow the conversation rather than whatever
 * was selected before.
 */
function open(session: SessionSummary): void {
	if (workspace.branchByPath.has(session.cwd) || session.cwd === workspace.mainRoot) workspace.select(session.cwd);
	emit("open", session.id);
}

function title(session: SessionSummary): string {
	return session.name || session.firstMessage || "Untitled session";
}

function rename(session: SessionSummary): void {
	quasar
		.dialog({
			title: "Rename session",
			prompt: { model: session.name ?? "", type: "text", label: "Name" },
			cancel: true,
		})
		.onOk((name: string) => {
			const trimmed = name.trim();
			if (trimmed) void app.rename(session.id, trimmed);
		});
}

function remove(session: SessionSummary): void {
	quasar
		.dialog({
			title: "Delete session",
			message: `Delete "${title(session)}"? The transcript file is removed and cannot be recovered.`,
			cancel: true,
			ok: { label: "Delete", color: "negative" },
		})
		.onOk(async () => {
			await app.remove(session.id);
			emit("deleted", session.id);
		});
}

async function fork(session: SessionSummary): Promise<void> {
	const id = await app.fork(session.id);
	emit("open", id);
}

function exportSession(session: SessionSummary, format: "html" | "jsonl"): void {
	window.open(api.exportUrl(session.id, format), "_blank");
}
</script>

<template>
	<div class="session-list">
		<q-input
			v-model="app.filter"
			dense
			outlined
			clearable
			debounce="150"
			placeholder="Filter sessions"
			class="session-list__filter"
		>
			<template #prepend><q-icon name="search" size="18px" /></template>
		</q-input>

		<q-list dense>
			<template v-for="group in app.groups" :key="group.cwd">
				<q-item-label header class="session-list__group">
					{{ group.label }}
					<q-tooltip>{{ group.cwd }}</q-tooltip>
				</q-item-label>

				<q-item
					v-for="session in group.sessions"
					:key="session.id"
					clickable
					:active="session.id === props.activeId"
					@click="open(session)"
				>
					<q-item-section>
						<q-item-label lines="1">{{ title(session) }}</q-item-label>
						<q-item-label caption lines="1">
							<q-badge
								v-if="workspace.branchByPath.get(session.cwd)"
								outline
								color="primary"
								class="q-mr-xs"
								:label="workspace.branchByPath.get(session.cwd)"
							/>
							{{ session.messageCount }} messages · {{ new Date(session.modified).toLocaleString() }}
						</q-item-label>
					</q-item-section>

					<q-item-section v-if="app.runningSessionIds.includes(session.id)" side>
						<q-spinner-dots color="primary" size="18px" />
					</q-item-section>

					<q-item-section side>
						<q-btn dense flat round size="sm" icon="more_vert" @click.stop>
							<q-menu auto-close>
								<q-list dense style="min-width: 180px">
									<q-item clickable @click="rename(session)">
										<q-item-section avatar><q-icon name="edit" size="18px" /></q-item-section>
										<q-item-section>Rename</q-item-section>
									</q-item>
									<q-item clickable @click="fork(session)">
										<q-item-section avatar><q-icon name="call_split" size="18px" /></q-item-section>
										<q-item-section>Fork into a new session</q-item-section>
									</q-item>
									<q-item clickable @click="exportSession(session, 'html')">
										<q-item-section avatar><q-icon name="download" size="18px" /></q-item-section>
										<q-item-section>Export as HTML</q-item-section>
									</q-item>
									<q-item clickable @click="exportSession(session, 'jsonl')">
										<q-item-section avatar><q-icon name="data_object" size="18px" /></q-item-section>
										<q-item-section>Export as JSONL</q-item-section>
									</q-item>
									<q-separator />
									<q-item clickable class="text-negative" @click="remove(session)">
										<q-item-section avatar><q-icon name="delete" size="18px" /></q-item-section>
										<q-item-section>Delete</q-item-section>
									</q-item>
								</q-list>
							</q-menu>
						</q-btn>
					</q-item-section>
				</q-item>
			</template>

			<q-item v-if="app.groups.length === 0">
				<q-item-section class="text-grey-6">
					{{ app.filter ? "Nothing matches that filter" : "No sessions yet" }}
				</q-item-section>
			</q-item>
		</q-list>
	</div>
</template>

<style scoped lang="scss">
.session-list__filter {
	padding: 8px 8px 4px;
}

.session-list__group {
	padding-top: 10px;
	font-family: var(--lares-mono);
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: 0.05em;
}
</style>
