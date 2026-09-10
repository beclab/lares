<template>
  <Teleport to="body">
    <div class="lares-preview" role="dialog" aria-modal="true" :aria-label="t('preview')">
      <header class="lares-preview__bar">
        <button
          type="button"
          class="lares-preview__icon-btn"
          :aria-label="t('back')"
          @click="$emit('close')"
        >
          <svg class="lares-preview__glyph" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14.5 6 9 12l5.5 6" />
          </svg>
        </button>
        <h1 class="lares-preview__name" :title="path">{{ name }}</h1>
        <a
          v-if="downloadHref"
          class="lares-preview__download"
          :href="downloadHref"
          download
        >
          {{ t("download") }}
        </a>
        <span v-else class="lares-preview__side-spacer" aria-hidden="true" />
      </header>
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
  </Teleport>
</template>

<script>
import { fileName } from "@olares/lares-core/files/filename";
import LaresPreviewBody from "./PreviewBody.vue";

export default {
  name: "LaresPreview",
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
  emits: ["close", "retry", "open"],
  computed: {
    name() {
      return this.data?.name || fileName(this.path);
    },
  },
};
</script>

<style scoped>
.lares-preview {
  position: fixed;
  z-index: 50;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  inset: 0;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  background: var(--q-background-1);
  color: var(--q-ink-1);
}

.lares-preview__bar {
  position: relative;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
  padding: 6px 8px;
}

.lares-preview__icon-btn,
.lares-preview__side-spacer {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
}

.lares-preview__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  padding: 0;
  background: transparent;
  color: var(--q-ink-1);
}

.lares-preview__icon-btn:active {
  background: var(--q-btn-bg-pressed);
}

.lares-preview__glyph {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.lares-preview__name {
  position: absolute;
  left: 50%;
  max-width: calc(100% - 152px);
  margin: 0;
  overflow: hidden;
  font-size: 18px;
  font-weight: 600;
  line-height: 24px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  transform: translateX(-50%);
  pointer-events: none;
}

.lares-preview__download {
  display: inline-flex;
  min-width: 40px;
  height: 32px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--q-separator);
  border-radius: 10px;
  padding: 0 12px;
  background: var(--q-background-3);
  color: var(--q-ink-1);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 18px;
  text-decoration: none;
}

.lares-preview__download:active {
  background: var(--q-btn-bg-pressed);
}
</style>
