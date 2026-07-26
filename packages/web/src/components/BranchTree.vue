<script setup lang="ts">
import type { SessionTreeNode } from "@lares/shared";
import { computed } from "vue";

const props = defineProps<{ roots: SessionTreeNode[]; leafId: string | null }>();
const emit = defineEmits<{
	navigate: [entryId: string];
	fork: [entryId: string, mode: "at" | "before"];
}>();

interface FlatNode {
	node: SessionTreeNode;
	depth: number;
	/** True when the parent had more than one child, i.e. this is a real branch. */
	isBranchPoint: boolean;
}

/**
 * Only nodes that carry conversation are worth showing; model and thinking-level
 * changes would otherwise bury the branches in noise.
 */
function isInteresting(node: SessionTreeNode): boolean {
	if (node.kind === "message") return node.role === "user" || node.role === "assistant" || node.role === "bashExecution";
	return node.kind === "compaction" || node.kind === "branch_summary";
}

const flattened = computed<FlatNode[]>(() => {
	const rows: FlatNode[] = [];

	const walk = (nodes: SessionTreeNode[], depth: number): void => {
		const branching = nodes.length > 1;
		for (const node of nodes) {
			const show = isInteresting(node);
			if (show) rows.push({ node, depth, isBranchPoint: branching });
			walk(node.children, show ? depth + 1 : depth);
		}
	};

	walk(props.roots, 0);
	return rows;
});

const hasBranches = computed(() => flattened.value.some((row) => row.isBranchPoint));
</script>

<template>
	<div class="branch-tree">
		<div v-if="flattened.length === 0" class="branch-tree__empty">This session has no entries yet.</div>

		<div v-else-if="!hasBranches" class="branch-tree__hint">
			One straight path so far. Navigating back to an earlier message starts a branch here.
		</div>

		<div
			v-for="row in flattened"
			:key="row.node.id"
			class="branch-tree__row"
			:class="{
				'branch-tree__row--current': row.node.onCurrentPath,
				'branch-tree__row--leaf': row.node.id === leafId,
			}"
			:style="{ paddingLeft: `${8 + row.depth * 14}px` }"
		>
			<span class="branch-tree__role">{{ row.node.role ?? row.node.kind }}</span>
			<span class="branch-tree__preview">{{ row.node.label || row.node.preview || "—" }}</span>
			<q-icon v-if="row.isBranchPoint" name="call_split" size="14px" class="branch-tree__mark" />

			<div class="branch-tree__actions">
				<q-btn
					v-if="row.node.id !== leafId"
					dense
					flat
					size="sm"
					icon="undo"
					@click="emit('navigate', row.node.id)"
				>
					<q-tooltip>Continue from here, keeping the other branch</q-tooltip>
				</q-btn>
				<q-btn
					v-if="row.node.role === 'user'"
					dense
					flat
					size="sm"
					icon="replay"
					@click="emit('fork', row.node.id, 'before')"
				>
					<q-tooltip>New session that stops just before this message</q-tooltip>
				</q-btn>
				<q-btn dense flat size="sm" icon="call_split" @click="emit('fork', row.node.id, 'at')">
					<q-tooltip>New session with everything up to and including this entry</q-tooltip>
				</q-btn>
			</div>
		</div>
	</div>
</template>

<style scoped lang="scss">
.branch-tree {
	font-size: 12.5px;
}

.branch-tree__empty,
.branch-tree__hint {
	padding: 10px 12px;
	color: var(--lares-text-muted);
}

.branch-tree__row {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 3px 10px 3px 8px;
	border-left: 2px solid transparent;

	&:hover {
		background: var(--lares-surface-2);
	}
}

.branch-tree__row--current {
	border-left-color: var(--lares-accent);
}

.branch-tree__row--leaf {
	background: var(--lares-surface-2);
	font-weight: 600;
}

.branch-tree__role {
	flex-shrink: 0;
	width: 66px;
	color: var(--lares-text-muted);
	font-family: var(--lares-mono);
	font-size: 10.5px;
	text-transform: uppercase;
}

.branch-tree__preview {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.branch-tree__mark {
	color: var(--lares-warning);
}

.branch-tree__actions {
	display: flex;
	gap: 2px;
	opacity: 0;
	transition: opacity 0.15s;
}

.branch-tree__row:hover .branch-tree__actions {
	opacity: 1;
}
</style>
