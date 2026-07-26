<script setup lang="ts">
import type { DirEntry, GitFileStatus } from "@lares/shared";
import { computed } from "vue";
import { useAppStore } from "../stores/app-store";
import { useFilesStore } from "../stores/files-store";
import { useWorkspaceStore } from "../stores/workspace-store";

const emit = defineEmits<{ open: [path: string]; mention: [path: string] }>();

const files = useFilesStore();
const app = useAppStore();
const workspace = useWorkspaceStore();

interface Row {
	entry: DirEntry;
	depth: number;
}

/**
 * Flattens the open parts of the tree into one list so the template stays a
 * simple loop; a recursive component would re-render whole subtrees on every
 * expand.
 */
const rows = computed<Row[]>(() => {
	const out: Row[] = [];

	const walk = (path: string, depth: number): void => {
		for (const entry of files.children.get(path) ?? []) {
			out.push({ entry, depth });
			if (entry.isDir && files.expanded.has(entry.path)) walk(entry.path, depth + 1);
		}
	};

	walk(".", 0);
	return out;
});

const STATUS_LETTER: Record<GitFileStatus, string> = {
	modified: "M",
	added: "A",
	deleted: "D",
	renamed: "R",
	untracked: "U",
	conflict: "!",
};

function statusOf(entry: DirEntry): GitFileStatus | null {
	return files.gitByPath.get(entry.path)?.status ?? null;
}

function iconFor(entry: DirEntry): string {
	if (!entry.isDir) return "description";
	return files.expanded.has(entry.path) ? "folder_open" : "folder";
}

/**
 * The workspace can hold several repositories, so which directory counts as the
 * project is a choice. Making it here rather than guessing is also what lets
 * the worktree switcher appear for a repository nested in the workspace.
 */
async function useAsCwd(entry: DirEntry): Promise<void> {
	const root = app.config?.workspace;
	if (!root) return;
	workspace.select(`${root}/${entry.path}`);
	await workspace.load();
}

function activate(entry: DirEntry): void {
	if (entry.isDir) {
		void files.toggle(entry.path);
		return;
	}
	files.select(entry.path);
	emit("open", entry.path);
}
</script>

<template>
	<div class="file-tree">
		<div class="file-tree__bar">
			<span v-if="files.git?.branch" class="file-tree__branch">
				<q-icon name="account_tree" size="14px" />
				{{ files.git.branch }}
			</span>
			<span v-if="files.changedCount > 0" class="file-tree__changed">{{ files.changedCount }} changed</span>
			<q-space />
			<q-btn dense flat size="sm" icon="refresh" @click="files.refresh()">
				<q-tooltip>Reload the tree</q-tooltip>
			</q-btn>
		</div>

		<q-banner v-if="files.error" dense class="bg-negative text-white">{{ files.error }}</q-banner>

		<div class="file-tree__rows">
			<div
				v-for="row in rows"
				:key="row.entry.path"
				class="file-tree__row"
				:class="{ 'file-tree__row--selected': files.selected === row.entry.path }"
				:style="{ paddingLeft: `${6 + row.depth * 14}px` }"
				@click="activate(row.entry)"
			>
				<q-icon
					v-if="row.entry.isDir"
					:name="files.expanded.has(row.entry.path) ? 'expand_more' : 'chevron_right'"
					size="16px"
					class="file-tree__chevron"
				/>
				<span v-else class="file-tree__chevron" />

				<q-icon :name="iconFor(row.entry)" size="15px" class="file-tree__icon" />
				<span class="file-tree__name">{{ row.entry.name }}</span>

				<span v-if="statusOf(row.entry)" :class="`file-tree__status file-tree__status--${statusOf(row.entry)}`">
					{{ STATUS_LETTER[statusOf(row.entry) as GitFileStatus] }}
				</span>

				<q-btn
					v-if="row.entry.isDir"
					dense
					flat
					size="sm"
					icon="input"
					class="file-tree__action"
					@click.stop="useAsCwd(row.entry)"
				>
					<q-tooltip>Work here: new sessions and the tree start from this directory</q-tooltip>
				</q-btn>

				<q-btn
					v-else
					dense
					flat
					size="sm"
					icon="alternate_email"
					class="file-tree__action"
					@click.stop="emit('mention', row.entry.path)"
				>
					<q-tooltip>Mention in the prompt</q-tooltip>
				</q-btn>
			</div>

			<div v-if="rows.length === 0 && !files.loading.has('.')" class="file-tree__empty">
				The workspace is empty.
			</div>
		</div>
	</div>
</template>

<style scoped lang="scss">
.file-tree {
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 0;
	font-size: 12.5px;
}

.file-tree__bar {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 4px 6px 4px 10px;
	border-bottom: 1px solid var(--lares-border);
	color: var(--lares-text-muted);
	font-size: 11.5px;
}

.file-tree__branch {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	font-family: var(--lares-mono);
}

.file-tree__changed {
	color: var(--lares-accent);
}

.file-tree__rows {
	flex: 1;
	min-height: 0;
	overflow: auto;
	padding: 4px 0;
}

.file-tree__row {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 2px 6px 2px 0;
	cursor: pointer;
	white-space: nowrap;

	&:hover {
		background: var(--lares-surface-2);
	}
}

.file-tree__row--selected {
	background: var(--lares-surface-2);
}

.file-tree__chevron {
	flex-shrink: 0;
	width: 16px;
	color: var(--lares-text-muted);
}

.file-tree__icon {
	flex-shrink: 0;
	color: var(--lares-text-muted);
}

.file-tree__name {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
}

.file-tree__status {
	flex-shrink: 0;
	width: 14px;
	text-align: center;
	font-family: var(--lares-mono);
	font-size: 11px;
	font-weight: 700;
}

.file-tree__status--modified,
.file-tree__status--renamed {
	color: #d29922;
}

.file-tree__status--added,
.file-tree__status--untracked {
	color: var(--lares-success);
}

.file-tree__status--deleted,
.file-tree__status--conflict {
	color: var(--lares-danger);
}

.file-tree__action {
	opacity: 0;
}

.file-tree__row:hover .file-tree__action {
	opacity: 1;
}

.file-tree__empty {
	padding: 10px;
	color: var(--lares-text-muted);
}
</style>
