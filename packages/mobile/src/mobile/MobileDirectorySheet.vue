<template>
  <LaresSheet :open="open" :title="t('desktop.chooseFolder')" @close="$emit('close')">
    <div class="mobile-directory">
      <nav v-if="state.listing" class="mobile-directory__crumbs" :aria-label="t('desktop.folderPath')">
        <button
          v-for="crumb in state.listing.crumbs"
          :key="crumb.path"
          type="button"
          @click="$emit('browse', crumb.path)"
        >
          {{ crumb.path === state.listing.home ? t("desktop.home") : crumb.name }}
        </button>
      </nav>
      <div class="mobile-directory__body">
        <p v-if="state.loading" class="mobile-directory__status">{{ t("desktop.loadingFolders") }}</p>
        <p v-else-if="state.error" class="mobile-directory__error">{{ state.error }}</p>
        <template v-else-if="state.listing">
          <button
            v-for="entry in visibleEntries"
            :key="entry.path"
            type="button"
            class="mobile-directory__row"
            :data-selected="selected === entry.path"
            @click="selected = entry.path"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5h6l1.6 2H20.5v9H3.5z" /></svg>
            <span>{{ entry.name }}</span>
            <span
              class="mobile-directory__open"
              role="button"
              tabindex="0"
              :aria-label="entry.name"
              @click.stop="$emit('browse', entry.path)"
              @keydown.enter.stop="$emit('browse', entry.path)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
            </span>
          </button>
          <p v-if="visibleEntries.length === 0" class="mobile-directory__status">{{ t("desktop.noFolders") }}</p>
        </template>
      </div>
      <footer class="mobile-directory__footer">
        <p class="mobile-directory__path">{{ selected || state.listing?.path || "" }}</p>
        <div class="mobile-directory__tools">
          <button
            type="button"
            class="mobile-directory__new-folder"
            :disabled="!state.listing?.path || state.loading || state.creatingFolder"
            @click="newFolderOpen = true"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            <span>{{ t("desktop.newFolder") }}</span>
          </button>
          <label class="mobile-directory__hidden">
            <input
              type="checkbox"
              :checked="state.showHidden"
              @change="$emit('toggle-hidden', $event.target.checked)"
            />
            <span>{{ t("desktop.showHiddenFiles") }}</span>
          </label>
        </div>
        <div class="mobile-directory__actions">
          <button type="button" class="mobile-directory__cancel" :disabled="state.creating" @click="$emit('close')">
            {{ t("desktop.cancel") }}
          </button>
          <button
            type="button"
            class="mobile-directory__choose"
            :disabled="state.loading || state.creating || !(selected || state.listing?.path)"
            @click="$emit('choose', selected || state.listing.path)"
          >
            {{ state.creating ? t("desktop.addingWorkspace") : t("desktop.addWorkspace") }}
          </button>
        </div>
      </footer>
    </div>
    <LaresMobileDirectoryNewFolder
      :open="newFolderOpen"
      :busy="state.creatingFolder"
      :t="t"
      @close="newFolderOpen = false"
      @create="onCreateFolder"
    />
  </LaresSheet>
</template>

<script>
import LaresSheet from "../settings/Sheet.vue";
import LaresMobileDirectoryNewFolder from "./MobileDirectoryNewFolder.vue";

export default {
  name: "LaresMobileDirectorySheet",
  components: { LaresSheet, LaresMobileDirectoryNewFolder },
  props: {
    open: { type: Boolean, default: false },
    state: { type: Object, required: true },
    t: { type: Function, required: true },
  },
  emits: ["close", "browse", "choose", "create-folder", "toggle-hidden"],
  data() {
    return { selected: "", newFolderOpen: false };
  },
  computed: {
    visibleEntries() {
      const entries = this.state.listing?.entries ?? [];
      return this.state.showHidden ? entries : entries.filter((entry) => !entry.hidden);
    },
  },
  watch: {
    "state.listing.path"() {
      this.selected = this.state.selectPath || "";
    },
    "state.selectPath"(path) {
      if (path) this.selected = path;
    },
    "state.creatingFolder"(busy, was) {
      if (was && !busy && !this.state.error) this.newFolderOpen = false;
    },
    open(value) {
      if (!value) {
        this.newFolderOpen = false;
        this.selected = "";
      }
    },
  },
  methods: {
    onCreateFolder(name) {
      this.$emit("create-folder", name);
    },
  },
};
</script>

<style scoped>
.mobile-directory { display:flex; min-height:min(420px, 55vh); flex-direction:column; margin:-4px 0 0; }
.mobile-directory svg { width:20px; height:20px; flex-shrink:0; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
.mobile-directory__crumbs { display:flex; gap:4px; overflow:auto; padding:0 20px 8px; }
.mobile-directory__crumbs button { flex-shrink:0; border:0; border-radius:8px; padding:6px 8px; background:transparent; color:var(--q-ink-3); font-size:14px; }
.mobile-directory__body { flex:1; min-height:0; overflow:auto; padding:0 12px; }
.mobile-directory__row { display:flex; width:100%; align-items:center; gap:10px; border:0; border-radius:12px; padding:12px 10px; background:transparent; color:var(--q-ink-1); text-align:left; }
.mobile-directory__row[data-selected="true"],
.mobile-directory__row:active { background:var(--q-background-hover); }
.mobile-directory__row > span:first-of-type { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.mobile-directory__open { display:grid; width:32px; height:32px; place-items:center; color:var(--q-ink-3); }
.mobile-directory__status,
.mobile-directory__error { margin:16px 8px; color:var(--q-ink-3); font-size:15px; text-align:center; }
.mobile-directory__error { color:var(--q-orange-default); }
.mobile-directory__footer { display:flex; flex-direction:column; gap:10px; padding:12px 20px calc(12px + env(safe-area-inset-bottom, 0px)); border-top:1px solid var(--q-separator); }
.mobile-directory__path { width:100%; margin:0; overflow:hidden; color:var(--q-ink-3); font-size:13px; text-overflow:ellipsis; white-space:nowrap; }
.mobile-directory__tools { display:flex; flex-wrap:wrap; align-items:center; gap:10px 14px; }
.mobile-directory__new-folder { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--q-separator); border-radius:999px; padding:0 12px; min-height:36px; background:transparent; color:var(--q-ink-2); font:inherit; font-size:14px; }
.mobile-directory__new-folder svg { width:16px; height:16px; }
.mobile-directory__hidden { display:inline-flex; align-items:center; gap:8px; color:var(--q-ink-3); font-size:14px; }
.mobile-directory__hidden input { width:16px; height:16px; margin:0; }
.mobile-directory__actions { display:flex; justify-content:flex-end; gap:8px; }
.mobile-directory__cancel,
.mobile-directory__choose { min-height:40px; border-radius:10px; padding:0 14px; font:inherit; }
.mobile-directory__cancel { border:1px solid var(--q-separator); background:transparent; color:var(--q-ink-2); }
.mobile-directory__choose { border:0; background:var(--q-blue-default); color:var(--q-ink-on-brand); }
.mobile-directory button:disabled { opacity:.5; }
</style>
