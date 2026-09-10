<template>
  <Transition name="lares-panel">
    <div v-if="rows.length" class="desktop-queue">
    <div class="desktop-queue__panel">
      <button
        v-if="rows.length > 1"
        type="button"
        class="desktop-queue__header"
        :aria-expanded="expanded"
        :disabled="Boolean(editing || busy)"
        @click="collapsed = !collapsed"
      >
        <QueueIcon />
        <span>{{ t("queue.count", { n: rows.length }) }}</span>
        <ChevronIcon :class="{ 'is-open': expanded }" />
      </button>
      <ul
        class="desktop-queue__list"
        :data-expanded="rows.length === 1 || expanded ? 'true' : 'false'"
      >
        <li v-for="row in rows" :key="row.id" class="desktop-queue__row">
          <QueueIcon v-if="rows.length === 1" class="desktop-queue__lead" />
          <input
            v-if="editing?.id === row.id"
            ref="editor"
            v-model="editing.text"
            class="desktop-queue__editor"
            :aria-label="t('queue.edit')"
            @keydown.esc="editing = null"
            @keydown.enter.exact.prevent="saveEdit"
          />
          <span v-else class="desktop-queue__preview">{{ row.preview }}</span>
          <div class="desktop-queue__actions">
            <template v-if="editing?.id === row.id">
              <ActionButton
                :label="t('queue.save')"
                :disabled="Boolean(busy) || !editing.text.trim()"
                icon="check"
                @click="saveEdit"
              />
              <ActionButton
                :label="t('queue.cancelEdit')"
                :disabled="Boolean(busy)"
                icon="close"
                @click="editing = null"
              />
            </template>
            <template v-else>
              <ActionButton
                :label="t('queue.edit')"
                :disabled="Boolean(busy) || row.text == null"
                icon="edit"
                @click="beginEdit(row)"
              />
              <ActionButton
                :label="t('queue.remove')"
                :disabled="Boolean(busy)"
                icon="trash"
                @click="$emit('action', row.id, { kind: 'remove' })"
              />
              <ActionButton
                :label="t('queue.steer')"
                :disabled="Boolean(busy) || !running"
                icon="send"
                @click="$emit('action', row.id, { kind: 'steer' })"
              />
            </template>
          </div>
        </li>
      </ul>
    </div>
    </div>
  </Transition>
</template>

<script>
import { h } from "vue";
import LaresPcTooltip from "./ui/PcTooltip.vue";

const paths = {
  check: "m4 8 2.5 2.5L12 5",
  close: "m4.5 4.5 7 7m0-7-7 7",
  edit: "M3.5 11.8V13h1.2l7.7-7.7-1.7-1.7z",
  trash: "M4 5h8M6 5V3.5h4V5m-5 0 .6 8h4.8l.6-8",
  send: "m3 3 10 5-10 5 2-5z",
};

const glyph = (name, path, extra = {}) => ({
  name,
  render() {
    return h("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", ...extra }, [
      h("path", { d: path }),
    ]);
  },
});

const QueueIcon = glyph("QueueIcon", "M3 4.5h10M3 8h7M3 11.5h4");
const ChevronIcon = glyph("ChevronIcon", "m4 6 4 4 4-4");

const ActionButton = {
  name: "QueueActionButton",
  components: { LaresPcTooltip },
  props: {
    label: { type: String, required: true },
    icon: { type: String, required: true },
    disabled: { type: Boolean, default: false },
  },
  emits: ["click"],
  render() {
    return h(LaresPcTooltip, { label: this.label, placement: "bottom" }, {
      default: () => h("button", {
        type: "button",
        class: "desktop-queue__action",
        disabled: this.disabled,
        "aria-label": this.label,
        onClick: () => this.$emit("click"),
      }, [
        h("svg", { viewBox: "0 0 16 16", "aria-hidden": "true" }, [
          h("path", { d: paths[this.icon] }),
        ]),
      ]),
    });
  },
};

export default {
  name: "LaresDesktopQueue",
  components: { QueueIcon, ChevronIcon, ActionButton },
  props: {
    items: { type: Array, default: () => [] },
    running: { type: Boolean, default: false },
    busy: { type: String, default: "" },
    t: { type: Function, required: true },
  },
  emits: ["action"],
  data() {
    return { collapsed: true, editing: null };
  },
  computed: {
    rows() {
      return this.items.filter((row) => row?.placement === "queued");
    },
    expanded() {
      return !this.collapsed || Boolean(this.editing || this.busy);
    },
  },
  watch: {
    rows(next) {
      if (!next.length) this.collapsed = true;
      if (this.editing && !next.some((row) => row.id === this.editing.id)) this.editing = null;
    },
  },
  methods: {
    beginEdit(row) {
      if (row.text == null) return;
      this.editing = { id: row.id, text: row.text };
      this.$nextTick(() => {
        const editor = Array.isArray(this.$refs.editor) ? this.$refs.editor[0] : this.$refs.editor;
        editor?.focus?.();
      });
    },
    saveEdit() {
      if (!this.editing?.text.trim()) return;
      const { id, text } = this.editing;
      this.$emit("action", id, { kind: "edit", content: [{ type: "text", text }] });
      this.editing = null;
    },
  },
};
</script>

<style scoped>
.desktop-queue { box-sizing:border-box; width:calc(100% - 24px); margin:0 auto -3px; padding:0 8px; }
.desktop-queue__panel { overflow:hidden; border:1px solid var(--q-separator); border-bottom:0; border-radius:12px 12px 0 0; padding:2px 0; background:var(--q-background-3); }
.desktop-queue__header { display:flex; width:100%; height:36px; align-items:center; gap:10px; border:0; padding:4px 12px; background:transparent; color:var(--q-ink-1); text-align:left; cursor:pointer; }
.desktop-queue__header span { min-width:0; flex:1; font-size:13px; font-weight:500; }
.desktop-queue__header .is-open { transform:rotate(180deg); }
.desktop-queue__header > svg,
.desktop-queue__header .is-open { transition:transform var(--lares-duration-fast, 120ms) var(--lares-ease-out, ease); }
.desktop-queue__list { max-height:0; overflow:hidden; margin:0; padding:0; list-style:none; opacity:0; transition:max-height var(--lares-duration-normal, 220ms) var(--lares-ease-out, cubic-bezier(0.32, 0.72, 0, 1)), opacity var(--lares-duration-normal, 220ms) var(--lares-ease-out, cubic-bezier(0.32, 0.72, 0, 1)); }
.desktop-queue__list[data-expanded="true"] { max-height:180px; overflow-y:auto; opacity:1; }
@media (prefers-reduced-motion: reduce) {
  .desktop-queue__list,
  .desktop-queue__header > svg,
  .desktop-queue__header .is-open { transition:none; }
  .desktop-queue__list[data-expanded="false"] { opacity:1; }
}
.desktop-queue__row { display:flex; box-sizing:border-box; width:100%; height:36px; align-items:center; gap:10px; padding:4px 5px 4px 12px; }
.desktop-queue__row + .desktop-queue__row { border-top:1px solid var(--q-separator); }
.desktop-queue__lead,
.desktop-queue__header > svg { flex:none; color:var(--q-ink-3); }
.desktop-queue__preview,
.desktop-queue__editor { min-width:0; flex:1; font:inherit; font-size:13px; }
.desktop-queue__preview { overflow:hidden; color:var(--q-ink-2); text-overflow:ellipsis; white-space:nowrap; }
.desktop-queue__editor { box-sizing:border-box; height:28px; border:1px solid var(--q-input-stroke); border-radius:6px; padding:0 8px; outline:none; background:var(--q-background-1); color:var(--q-ink-1); }
.desktop-queue__editor:focus { border-color:var(--q-blue-default); }
.desktop-queue__actions { display:flex; flex:none; align-items:center; gap:4px; }
:deep(.desktop-queue__action) { display:grid; width:28px; height:28px; place-items:center; border:0; border-radius:50%; padding:0; background:transparent; color:var(--q-ink-3); cursor:pointer; }
:deep(.desktop-queue__action:hover:not(:disabled)) { background:var(--q-background-hover); color:var(--q-ink-2); }
:deep(.desktop-queue__action:disabled) { opacity:.45; cursor:default; }
.desktop-queue svg,
:deep(.desktop-queue__action svg) { width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:1.4; stroke-linecap:round; stroke-linejoin:round; }
</style>
