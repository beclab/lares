<template>
  <LaresPcDialog
    :open="state.open"
    :title="t('desktop.selectWorkspaceDirectory')"
    :close-label="t('desktop.close')"
    :busy="state.creating || state.creatingFolder"
    :width="620"
    variant="directory"
    @close="$emit('close')"
  >
    <template #header="{ titleId }">
      <div class="directory-browser__header">
        <h2 :id="titleId">{{ t("desktop.selectWorkspaceDirectory") }}</h2>
        <div class="directory-browser__location">
          <input
            v-if="editingPath"
            ref="pathInput"
            v-model="pathDraft"
            :aria-label="t('desktop.folderPath')"
            @keydown.enter.prevent="submitPath"
            @keydown.esc.prevent="editingPath = false"
            @blur="editingPath = false"
          />
          <nav v-else-if="state.listing" :aria-label="t('desktop.folderPath')">
            <template v-for="(crumb, index) in homeCrumbs" :key="crumb.path">
              <span v-if="index" aria-hidden="true">/</span>
              <button type="button" @click="$emit('browse', crumb.path)">
                {{ crumb.path === state.listing.home ? t("desktop.home") : crumb.name }}
              </button>
            </template>
          </nav>
          <button
            v-if="!editingPath"
            type="button"
            class="directory-browser__edit"
            :aria-label="t('desktop.folderPath')"
            @click="beginPathEdit"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m4 16-.75 4.25L7.5 19.5 18.4 8.6a2.1 2.1 0 0 0-3-3Z" />
              <path d="m13.8 7.2 3 3M3 21h18" />
            </svg>
          </button>
        </div>
      </div>
    </template>
    <div class="directory-browser">
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
              {{ state.creating ? t("desktop.addingWorkspace") : t("desktop.open") }}
            </button>
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
    return { selected: "", newFolderOpen: false, editingPath: false, pathDraft: "" };
  },
  computed: {
    visibleEntries() {
      const entries = this.state.listing?.entries ?? [];
      return this.state.showHidden ? entries : entries.filter((entry) => !entry.hidden);
    },
    homeCrumbs() {
      const crumbs = this.state.listing?.crumbs ?? [];
      const home = this.state.listing?.home;
      const homeIndex = crumbs.findIndex((crumb) => crumb.path === home);
      return homeIndex >= 0 ? crumbs.slice(homeIndex) : crumbs;
    },
  },
  watch: {
    "state.listing.path"() {
      this.selected = this.state.selectPath || "";
      this.pathDraft = this.state.listing?.path || "";
      this.editingPath = false;
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
    beginPathEdit() {
      this.pathDraft = this.state.listing?.path || "";
      this.editingPath = true;
      this.$nextTick(() => {
        this.$refs.pathInput?.focus();
        this.$refs.pathInput?.select();
      });
    },
    submitPath() {
      const path = this.pathDraft.trim();
      if (!path) return;
      this.editingPath = false;
      this.$emit("browse", path);
    },
  },
};
</script>

<style scoped>
.directory-browser__header { height:76px; }
.directory-browser__header h2 { height:42px; margin:0; padding:19px 22px 0; font-size:16px; font-weight:500; line-height:22px; }
.directory-browser__location { display:flex; height:34px; align-items:center; gap:8px; padding:0 20px 7px 22px; }
.directory-browser__location nav { display:flex; min-width:0; flex:1; align-items:center; gap:7px; overflow:hidden; color:var(--q-ink-2); }
.directory-browser__location nav button { min-width:0; overflow:hidden; border:0; padding:0; background:transparent; color:inherit; font:inherit; font-size:14px; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; }
.directory-browser__location nav button:hover { color:var(--q-ink-1); }
.directory-browser__location input { box-sizing:border-box; min-width:0; height:27px; flex:1; border:1px solid var(--q-input-stroke); border-radius:5px; padding:0 8px; outline:none; background:var(--q-background-2); color:var(--q-ink-1); font:inherit; font-size:13px; }
.directory-browser__edit { display:grid; width:30px; height:30px; flex-shrink:0; place-items:center; border:0; border-radius:6px; background:transparent; color:var(--q-ink-2); cursor:pointer; }
.directory-browser__edit:hover { background:var(--q-background-hover); color:var(--q-ink-1); }
.directory-browser__edit svg { width:17px; height:17px; fill:none; stroke:currentColor; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }
.directory-browser { display:flex; height:min(316px, calc(100vh - 186px)); flex-direction:column; }
.directory-browser svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
.directory-browser__body { flex:1; min-height:0; overflow:auto; padding:13px 20px; }
.directory-browser__row { display:flex; width:100%; height:28px; align-items:center; gap:7px; border:0; border-radius:6px; padding:0 6px; background:transparent; color:var(--q-ink-1); font-size:14px; text-align:left; }
.directory-browser__row:hover { background:var(--q-background-hover); }
.directory-browser__row[data-selected="true"] { background:var(--q-background-selected); }
.directory-browser__row > span { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.directory-browser__open { display:grid; width:26px; height:26px; place-items:center; border:0; background:transparent; color:var(--q-ink-3); }
.directory-browser__status,
.directory-browser__error { margin:20px; color:var(--q-ink-3); font-size:14px; text-align:center; }
.directory-browser__error { color:var(--q-orange-default); }
.directory-browser__footer { display:flex; width:100%; align-items:center; justify-content:space-between; gap:12px; }
.directory-browser__footer-left { display:flex; min-width:0; flex:1; align-items:center; gap:12px; }
.directory-browser__footer-right { display:flex; flex-shrink:0; align-items:center; gap:8px; }
.directory-browser__new-folder { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--q-btn-stroke); border-radius:999px; padding:0 14px; height:34px; background:transparent; color:var(--q-ink-1); font:inherit; font-size:14px; white-space:nowrap; }
/* The footer is a dialog slot, outside `.directory-browser`, so it misses the shared icon rule. */
.directory-browser__new-folder svg { width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
.directory-browser__hidden { display:inline-flex; align-items:center; color:var(--q-ink-2); font-size:13px; white-space:nowrap; cursor:pointer; }
.directory-browser__hidden input { position:absolute; width:1px; height:1px; overflow:hidden; opacity:0; pointer-events:none; }
.directory-browser__hidden:has(input:checked) { color:var(--q-ink-1); }
.directory-browser__cancel,
.directory-browser__choose { min-width:67px; height:34px; border-radius:999px; padding:0 14px; font-size:14px; }
.directory-browser__cancel { border:1px solid var(--q-btn-stroke); background:transparent; color:var(--q-ink-1); }
.directory-browser__new-folder:hover:not(:disabled),
.directory-browser__cancel:hover:not(:disabled) { background:var(--q-btn-bg-hover); border-color:var(--q-btn-stroke-hover); }
/* The confirm button is the inverse surface: white on dark, dark on light. */
.directory-browser__choose { border:0; background:var(--q-background-9); color:var(--q-background-1); }
.directory-browser button,
.directory-browser__cancel,
.directory-browser__choose { cursor:pointer; font:inherit; }
.directory-browser button:disabled,
.directory-browser__cancel:disabled,
.directory-browser__choose:disabled { opacity:.5; cursor:default; }
</style>
