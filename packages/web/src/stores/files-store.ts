import type { DirEntry, GitChange, GitStatusResponse } from "@lares/shared";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api } from "../lib/api";

/**
 * Holds the workspace tree one directory at a time.
 *
 * Directories are fetched when they are first expanded rather than up front:
 * a checked-out repository can hold tens of thousands of files, and only the
 * handful of paths the user opens are ever worth the round trip.
 */
export const useFilesStore = defineStore("files", () => {
	const children = ref<Map<string, DirEntry[]>>(new Map());
	const expanded = ref<Set<string>>(new Set());
	const loading = ref<Set<string>>(new Set());
	const selected = ref<string | null>(null);
	const error = ref<string | null>(null);
	const git = ref<GitStatusResponse | null>(null);
	/** A path the tree or the viewer wants the composer to reference. */
	const pendingMention = ref<string | null>(null);
	/**
	 * Workspace-relative directory the tree is rooted at. Switching checkouts
	 * moves it, so the tree shows the branch the next session will run against.
	 */
	const root = ref(".");

	/** Git reports paths relative to the repository root, which is where lookups start. */
	const gitByPath = computed<Map<string, GitChange>>(() => {
		const map = new Map<string, GitChange>();
		for (const change of git.value?.changes ?? []) map.set(change.path, change);
		return map;
	});

	const changedCount = computed(() => git.value?.changes.length ?? 0);

	/**
	 * The tree always keys its top node as ".", but that node stands for whichever
	 * checkout is selected, so only the request is redirected.
	 */
	function requestPath(path: string): string | undefined {
		const target = path === "." ? root.value : path;
		return target === "." ? undefined : target;
	}

	async function load(path: string): Promise<void> {
		if (loading.value.has(path)) return;
		loading.value = new Set(loading.value).add(path);
		try {
			const listing = await api.listFiles(requestPath(path));
			children.value = new Map(children.value).set(path, listing.entries);
			error.value = null;
		} catch (err) {
			error.value = err instanceof Error ? err.message : String(err);
		} finally {
			const next = new Set(loading.value);
			next.delete(path);
			loading.value = next;
		}
	}

	async function toggle(path: string): Promise<void> {
		const next = new Set(expanded.value);
		if (next.has(path)) {
			next.delete(path);
			expanded.value = next;
			return;
		}
		next.add(path);
		expanded.value = next;
		if (!children.value.has(path)) await load(path);
	}

	async function refresh(): Promise<void> {
		const open = [".", ...expanded.value];
		children.value = new Map();
		await Promise.all(open.map(load));
		await loadGit();
	}

	async function loadGit(): Promise<void> {
		try {
			git.value = await api.gitStatus(requestPath("."));
		} catch {
			// A missing git binary or a non-repository workspace is not an error
			// worth surfacing; the tree just renders without status badges.
			git.value = null;
		}
	}

	async function init(): Promise<void> {
		await Promise.all([load("."), loadGit()]);
	}

	/** Re-roots the tree, discarding everything cached from the old checkout. */
	async function setRoot(path: string): Promise<void> {
		if (root.value === path) return;
		root.value = path;
		children.value = new Map();
		expanded.value = new Set();
		selected.value = null;
		await init();
	}

	function select(path: string | null): void {
		selected.value = path;
	}

	function requestMention(path: string): void {
		pendingMention.value = path;
	}

	function clearMention(): void {
		pendingMention.value = null;
	}

	return {
		children,
		expanded,
		loading,
		selected,
		error,
		git,
		gitByPath,
		changedCount,
		pendingMention,
		root,
		requestMention,
		clearMention,
		init,
		load,
		toggle,
		refresh,
		loadGit,
		select,
		setRoot,
	};
});
