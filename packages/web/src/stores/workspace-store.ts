import type { WorktreeInfo } from "@lares/shared";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { ApiError, api } from "../lib/api";
import { toWorkspaceRelative } from "../lib/paths";
import { useAppStore } from "./app-store";

/**
 * Tracks which checkout the app is pointed at.
 *
 * A worktree is just another directory inside the workspace, so nothing is
 * persisted: the selection decides where new sessions start and what the file
 * tree shows, and the list itself is re-read from git.
 */
export const useWorkspaceStore = defineStore("workspace", () => {
	const app = useAppStore();

	const selected = ref<string | null>(null);
	const mainRoot = ref<string | null>(null);
	const worktrees = ref<WorktreeInfo[]>([]);
	const isRepository = ref(false);
	const busy = ref(false);
	const error = ref<string | null>(null);

	/** Absolute path new sessions and the file tree use. */
	const cwd = computed(() => selected.value ?? app.config?.workspace ?? "");

	const current = computed(() => worktrees.value.find((entry) => entry.path === cwd.value) ?? null);

	const branchByPath = computed(() => {
		const map = new Map<string, string>();
		for (const entry of worktrees.value) if (entry.branch) map.set(entry.path, entry.branch);
		return map;
	});

	/** Workspace-relative path of the current checkout, which is what file routes take. */
	const relativeCwd = computed(() => toWorkspaceRelative(app.config?.workspace, selected.value));

	async function load(): Promise<void> {
		try {
			const response = await api.worktrees(relativeCwd.value);
			isRepository.value = response.isRepository;
			mainRoot.value = response.mainRoot;
			worktrees.value = response.worktrees;
			error.value = null;
		} catch (err) {
			isRepository.value = false;
			worktrees.value = [];
			error.value = err instanceof Error ? err.message : String(err);
		}
	}

	function select(path: string | null): void {
		selected.value = path;
	}

	async function add(branch: string, startPoint?: string): Promise<WorktreeInfo | null> {
		busy.value = true;
		error.value = null;
		try {
			const created = await api.addWorktree(relativeCwd.value, branch, startPoint);
			selected.value = created.path;
			await load();
			return created;
		} catch (err) {
			error.value = err instanceof Error ? err.message : String(err);
			return null;
		} finally {
			busy.value = false;
		}
	}

	/** Returns "dirty" when git refused because the checkout has uncommitted work. */
	async function remove(path: string, force = false): Promise<"removed" | "dirty" | "failed"> {
		busy.value = true;
		error.value = null;
		try {
			await api.removeWorktree(path, force);
			if (selected.value === path) selected.value = mainRoot.value;
			await load();
			return "removed";
		} catch (err) {
			if (err instanceof ApiError && err.status === 409) return "dirty";
			error.value = err instanceof Error ? err.message : String(err);
			return "failed";
		} finally {
			busy.value = false;
		}
	}

	return {
		selected,
		cwd,
		relativeCwd,
		mainRoot,
		worktrees,
		current,
		branchByPath,
		isRepository,
		busy,
		error,
		load,
		select,
		add,
		remove,
	};
});
