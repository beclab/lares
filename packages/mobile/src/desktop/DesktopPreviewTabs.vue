<template>
  <div class="preview-tabs" role="tablist" :aria-label="t('tabs')">
    <button
      type="button"
      role="tab"
      class="preview-tabs__chat"
      :data-active="active ? 'false' : 'true'"
      :aria-selected="!active"
      @click="$emit('chat')"
    >
      {{ t("chat") }}
    </button>
    <span class="preview-tabs__divider" aria-hidden="true" />
    <TransitionGroup name="lares-tab" tag="div" class="preview-tabs__list">
      <div
        v-for="tab in tabs"
        :key="tab.path"
        class="preview-tabs__tab"
        :data-active="tab.path === active ? 'true' : 'false'"
        role="tab"
        :aria-selected="tab.path === active"
      >
        <button
          type="button"
          class="preview-tabs__label"
          @click="$emit('activate', tab.path)"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 1.75h5l3 3V14.25H4zM9 1.75v3h3" />
          </svg>
          <span>{{ tab.name }}</span>
        </button>
        <button
          type="button"
          class="preview-tabs__close"
          :aria-label="t('close', { name: tab.name })"
          @click.stop="$emit('close', tab.path)"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4.5 4.5 7 7m0-7-7 7" />
          </svg>
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script>
export default {
  name: "LaresDesktopPreviewTabs",
  props: {
    tabs: { type: Array, required: true },
    // Empty while the reader is on the chat, so no file tab looks selected.
    active: { type: String, default: "" },
    t: { type: Function, required: true },
  },
  emits: ["chat", "activate", "close"],
};
</script>

<style scoped>
.preview-tabs { display:flex; min-width:0; flex:1; align-items:center; gap:8px; }
.preview-tabs__chat { height:24px; flex:none; padding:0 8px; border:0; border-radius:7px; background:transparent; color:var(--q-ink-3); cursor:pointer; font-size:12px; font-weight:500; }
.preview-tabs__chat:hover { background:var(--q-background-hover); color:var(--q-ink-1); }
.preview-tabs__chat[data-active="true"] { background:var(--q-background-3); color:var(--q-blue-default); }
.preview-tabs__divider { width:1px; height:16px; flex:none; background:var(--q-separator); }
.preview-tabs__list { position:relative; display:flex; min-width:0; flex:1; align-items:center; gap:6px; overflow-x:auto; scrollbar-width:none; }
.preview-tabs__chat,
.preview-tabs__tab,
.preview-tabs__label,
.preview-tabs__close { transition:background var(--lares-duration-fast, 120ms) var(--lares-ease-out, ease), color var(--lares-duration-fast, 120ms) var(--lares-ease-out, ease), border-color var(--lares-duration-fast, 120ms) var(--lares-ease-out, ease); }
.preview-tabs__list::-webkit-scrollbar { display:none; }
.preview-tabs__tab { display:inline-flex; max-width:180px; height:24px; flex:0 0 auto; align-items:center; padding:0 2px 0 8px; border:1px solid transparent; border-radius:7px; background:var(--q-background-3); color:var(--q-ink-2); }
.preview-tabs__tab:hover { background:var(--q-background-hover); color:var(--q-ink-1); }
.preview-tabs__tab[data-active="true"] { border-color:var(--q-input-stroke); background:var(--q-background-1); color:var(--q-ink-1); }
.preview-tabs__label { display:inline-flex; min-width:0; flex:1; align-items:center; gap:5px; padding:0; border:0; background:transparent; color:inherit; cursor:pointer; font-size:12px; font-weight:500; }
.preview-tabs__label svg { width:13px; height:13px; flex:none; fill:none; stroke:currentColor; stroke-linecap:round; stroke-linejoin:round; stroke-width:1.3; }
.preview-tabs__label span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.preview-tabs__close { display:grid; width:18px; height:18px; flex:none; place-items:center; padding:0; border:0; border-radius:5px; background:transparent; color:var(--q-ink-3); cursor:pointer; }
.preview-tabs__close:hover { background:var(--q-background-hover); color:var(--q-red-default); }
.preview-tabs__close svg { width:11px; height:11px; fill:none; stroke:currentColor; stroke-linecap:round; stroke-width:1.8; }
</style>
