<template>
  <LaresPcDialog
    :open="state.open"
    :title="t('desktop.chooseFolder')"
    :close-label="t('desktop.close')"
    :busy="state.creating || state.creatingFolder"
    :width="620"
    @close="$emit('close')"
  >
    <div class="directory-browser">
      <nav v-if="state.listing" class="directory-browser__crumbs" :aria-label="t('desktop.folderPath')">
        <button v-for="crumb in state.listing.crumbs" :key="crumb.path" type="button" @click="$emit('browse', crumb.path)">
          {{ crumb.path === state.listing.home ? t("desktop.home") : crumb.name }}
        </button>
      </nav>
      <div class="directory-browser__body">
        <p v-if="state.loading" class="directory-browser__status">{{ t("desktop.loadingFolders") }}</p>
        <p v-else-if="state.error" class="directory-browser__error">{{ state.error }}</p>
        <template v-else-if="state.listing">
          <div
            v-for="entry in visibleEntries"
            :key="entry.path"
            class="directory-browser__row"
            role="button"
            tabindex="0"
            @dblclick="$emit('browse', entry.path)"
            @click="selected = entry.path"
            @keydown.enter="$emit('browse', entry.path)"
            :data-selected="selected === entry.path"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5h6l1.6 2H20.5v9H3.5z" /></svg>
            <span>{{ entry.name }}</span>
            <button type="button" class="directory-browser__open" @click.stop="$emit('browse', entry.path)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
            </button>
          </div>
          <p v-if="visibleEntries.length === 0" class="directory-browser__status">{{ t("desktop.noFolders") }}</p>
        </template>
      </div>
    </div>
    <template #footer>
      <div class="directory-browser__footer">
        <p class="directory-browser__path">{{ selected || state.listing?.path || "" }}</p>
        <div class="directory-browser__footer-row">
          <div class="directory-browser__footer-left">
            <button
              type="button"
              class="directory-browser__new-folder"
              :disabled="!state.listing?.path || state.loading || state.creatingFolder"
              @click="newFolderOpen = true"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              <span>{{ t("desktop.newFolder") }}</span>
            </button>
            <label class="directory-browser__hidden">
              <input
                type="checkbox"
                :checked="state.showHidden"
                @change="$emit('toggle-hidden', $event.target.checked)"
              />
              <span>{{ t("desktop.showHiddenFiles") }}</span>
            </label>
          </div>
          <div class="directory-browser__footer-right">
            <button type="button" class="directory-browser__cancel" :disabled="state.creating" @click="$emit('close')">
              {{ t("desktop.cancel") }}
            </button>
            <button
              type="button"
              class="directory-browser__choose"
              :disabled="state.loading || state.creating || !(selected || state.listing?.path)"
              @click="$emit('choose', selected || state.listing.path)"
            >
              {{ state.creating ? t("desktop.addingWorkspace") : t("desktop.addWorkspace") }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </LaresPcDialog>
  <LaresDirectoryNewFolder
    :open="newFolderOpen"
    :busy="state.creatingFolder"
    :t="t"
    @close="newFolderOpen = false"
    @create="onCreateFolder"
  />
</template>

<script>
import LaresPcDialog from "./ui/PcDialog.vue";
import LaresDirectoryNewFolder from "./DirectoryNewFolder.vue";

export default {
  name: "LaresDirectoryBrowser",
  components: { LaresPcDialog, LaresDirectoryNewFolder },
  props: {
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
    "state.open"(open) {
      if (!open) {
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
.directory-browser { display:flex; height:min(440px, calc(100vh - 180px)); flex-direction:column; margin:-16px; }
.directory-browser svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
.directory-browser__crumbs { display:flex; gap:3px; min-height:38px; align-items:center; overflow:auto; padding:0 14px; border-bottom:1px solid var(--q-separator); }
.directory-browser__crumbs button { flex-shrink:0; border:0; border-radius:5px; padding:4px 6px; background:transparent; color:var(--q-ink-3); font-size:14px; }
.directory-browser__crumbs button:hover { background:var(--q-background-hover); color:var(--q-ink-1); }
.directory-browser__body { flex:1; min-height:0; overflow:auto; padding:8px; }
.directory-browser__row { display:flex; width:100%; align-items:center; gap:9px; border:0; border-radius:7px; padding:8px 10px; background:transparent; color:var(--q-ink-1); text-align:left; }
.directory-browser__row:hover,
.directory-browser__row[data-selected="true"] { background:var(--q-background-hover); }
.directory-browser__row > span { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.directory-browser__open { display:grid; width:26px; height:26px; place-items:center; border:0; background:transparent; color:var(--q-ink-3); }
.directory-browser__status,
.directory-browser__error { margin:20px; color:var(--q-ink-3); font-size:15px; text-align:center; }
.directory-browser__error { color:var(--q-orange-default); }
.directory-browser__footer { display:flex; width:100%; flex-direction:column; gap:10px; }
.directory-browser__path { min-width:0; margin:0; overflow:hidden; color:var(--q-ink-3); font-size:13px; text-overflow:ellipsis; white-space:nowrap; text-align:left; }
.directory-browser__footer-row { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.directory-browser__footer-left { display:flex; min-width:0; flex:1; align-items:center; gap:12px; }
.directory-browser__footer-right { display:flex; flex-shrink:0; align-items:center; gap:8px; }
.directory-browser__new-folder { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--q-separator); border-radius:999px; padding:0 10px; height:32px; background:transparent; color:var(--q-ink-2); font:inherit; font-size:13px; white-space:nowrap; }
.directory-browser__new-folder svg { width:14px; height:14px; }
.directory-browser__hidden { display:inline-flex; align-items:center; gap:6px; color:var(--q-ink-3); font-size:13px; white-space:nowrap; cursor:pointer; }
.directory-browser__hidden input { width:15px; height:15px; margin:0; }
.directory-browser__cancel,
.directory-browser__choose { min-width:76px; height:32px; border-radius:999px; padding:0 12px; }
.directory-browser__cancel { border:1px solid var(--q-separator); background:transparent; color:var(--q-ink-2); }
.directory-browser__choose { border:0; background:var(--q-blue-default); color:var(--q-ink-on-brand); }
.directory-browser button,
.directory-browser__cancel,
.directory-browser__choose { cursor:pointer; font:inherit; }
.directory-browser button:disabled,
.directory-browser__cancel:disabled,
.directory-browser__choose:disabled { opacity:.5; cursor:default; }
</style>
