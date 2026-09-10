<template>
  <section class="desktop-preview" :aria-label="t('preview')">
    <header class="desktop-preview__bar">
      <span class="desktop-preview__path" :title="path">{{ path }}</span>
      <a
        v-if="downloadHref"
        class="desktop-preview__download"
        :href="downloadHref"
        download
      >{{ t("download") }}</a>
    </header>
    <div class="desktop-preview__content">
      <LaresPreviewBody
        :path="path"
        :session-id="sessionId"
        :status="status"
        :data="data"
        :error="error"
        :media-src="mediaSrc"
        :href-for="hrefFor"
        :t="t"
        @retry="$emit('retry')"
        @open="$emit('open', $event)"
      />
    </div>
  </section>
</template>

<script>
import LaresPreviewBody from "../preview/PreviewBody.vue";

export default {
  name: "LaresDesktopPreview",
  components: { LaresPreviewBody },
  props: {
    path: { type: String, required: true },
    sessionId: { type: String, default: "" },
    status: { type: String, default: "loading" },
    data: { type: Object, default: null },
    error: { type: String, default: "" },
    mediaSrc: { type: String, default: "" },
    downloadHref: { type: String, default: "" },
    hrefFor: { type: Function, default: null },
    t: { type: Function, required: true },
  },
  emits: ["retry", "open"],
};
</script>

<style scoped>
/* Covers the transcript and the composer instead of replacing them, so the
   reader's place in the conversation survives a trip through the tabs. */
.desktop-preview { position:absolute; z-index:8; display:flex; min-width:0; min-height:0; flex-direction:column; inset:0; padding:12px 20px 20px; background:var(--q-background-1); }
.desktop-preview__bar { display:flex; min-width:0; flex:none; align-items:center; gap:12px; padding-bottom:10px; }
.desktop-preview__path { min-width:0; flex:1; overflow:hidden; padding:0 4px; color:var(--q-ink-3); font-size:12px; line-height:18px; text-overflow:ellipsis; white-space:nowrap; }
.desktop-preview__download { flex:none; color:var(--q-blue-default); font-size:12px; line-height:18px; text-decoration:none; }
.desktop-preview__content { display:flex; min-height:0; flex:1; flex-direction:column; overflow:hidden; border:1px solid var(--q-separator); border-radius:14px; background:var(--q-background-2); }
</style>
