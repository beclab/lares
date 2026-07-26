<script setup lang="ts">
import type { WorktreeInfo } from "@lares/shared";
import { useQuasar } from "quasar";
import { onMounted, ref } from "vue";
import { useWorkspaceStore } from "../stores/workspace-store";

const workspace = useWorkspaceStore();
const quasar = useQuasar();

const creating = ref(false);
const branch = ref("");

onMounted(() => {
	void workspace.load();
});

function label(entry: WorktreeInfo): string {
	return entry.branch ?? entry.path.split("/").filter(Boolean).pop() ?? entry.path;
}

function currentLabel(): string {
	const entry = workspace.current;
	if (entry) return label(entry);
	return workspace.cwd.split("/").filter(Boolean).pop() ?? "workspace";
}

function tooltip(): string {
	if (workspace.isRepository) return workspace.cwd;
	return `${workspace.cwd} is not a git repository. Pick one in the file tree to manage checkouts.`;
}

async function create(): Promise<void> {
	const name = branch.value.trim();
	if (!name) return;
	const created = await workspace.add(name);
	if (created) {
		creating.value = false;
		branch.value = "";
	}
}

/**
 * Removing a checkout with uncommitted work needs a second, explicit yes: git
 * refuses the first attempt, and forcing it silently would throw the work away.
 */
async function remove(entry: WorktreeInfo): Promise<void> {
	const result = await workspace.remove(entry.path);
	if (result !== "dirty") return;

	quasar
		.dialog({
			title: "Uncommitted changes",
			message: `${label(entry)} has changes that are not committed. Remove it anyway and lose them?`,
			cancel: true,
			ok: { label: "Remove anyway", color: "negative" },
		})
		.onOk(() => void workspace.remove(entry.path, true));
}
</script>

<template>
	<div class="worktrees">
		<q-btn
			dense
			flat
			no-caps
			class="worktrees__current"
			:icon="workspace.isRepository ? 'account_tree' : 'folder'"
			:label="currentLabel()"
			:disable="!workspace.isRepository"
		>
			<q-badge v-if="workspace.worktrees.length > 1" color="primary" class="q-ml-xs">
				{{ workspace.worktrees.length }}
			</q-badge>

			<q-tooltip>{{ tooltip() }}</q-tooltip>

			<q-menu v-if="workspace.isRepository">
				<q-list dense style="min-width: 240px">
					<q-item
						v-for="entry in workspace.worktrees"
						:key="entry.path"
						v-close-popup
						clickable
						:active="entry.path === workspace.cwd"
						@click="workspace.select(entry.path)"
					>
						<q-item-section>
							<q-item-label lines="1">
								{{ label(entry) }}
								<q-badge v-if="entry.isMain" outline color="grey" class="q-ml-xs" label="main" />
								<q-badge v-if="entry.locked" outline color="orange" class="q-ml-xs" label="locked" />
							</q-item-label>
							<q-item-label caption lines="1">{{ entry.path }}</q-item-label>
						</q-item-section>

						<q-item-section v-if="!entry.isMain" side>
							<q-btn dense flat round size="sm" icon="delete" color="negative" @click.stop="remove(entry)">
								<q-tooltip>Remove this checkout</q-tooltip>
							</q-btn>
						</q-item-section>
					</q-item>

					<q-separator />

					<q-item clickable @click="creating = true">
						<q-item-section avatar><q-icon name="add" size="18px" /></q-item-section>
						<q-item-section>New checkout…</q-item-section>
					</q-item>
				</q-list>
			</q-menu>
		</q-btn>

		<q-dialog v-model="creating">
			<q-card class="worktrees__dialog">
				<q-card-section class="text-subtitle1">New checkout</q-card-section>
				<q-card-section>
					<q-input
						v-model="branch"
						dense
						outlined
						autofocus
						label="Branch"
						hint="An existing branch is checked out; a new name is created from the current HEAD."
						@keydown.enter="create"
					/>
					<div v-if="workspace.error" class="worktrees__error">{{ workspace.error }}</div>
				</q-card-section>
				<q-card-actions align="right">
					<q-btn flat no-caps label="Cancel" @click="creating = false" />
					<q-btn
						unelevated
						no-caps
						color="primary"
						label="Create"
						:loading="workspace.busy"
						:disable="!branch.trim()"
						@click="create"
					/>
				</q-card-actions>
			</q-card>
		</q-dialog>
	</div>
</template>

<style scoped lang="scss">
.worktrees {
	display: flex;
	align-items: center;
	padding: 0 4px 6px;
}

.worktrees__current {
	max-width: 100%;
	justify-content: flex-start;
}

.worktrees__dialog {
	min-width: 380px;
}

.worktrees__error {
	margin-top: 8px;
	font-size: 12.5px;
	color: var(--q-negative);
}
</style>
