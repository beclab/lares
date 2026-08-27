<template>
  <div class="lares-preview" role="dialog" :aria-label="t('preview')">
    <header class="lares-preview__bar">
      <button type="button" class="lares-preview__back" @click="$emit('close')">{{ t("chat") }}</button>
      <strong class="lares-preview__name" :title="path">{{ name }}</strong>
      <a
        v-if="downloadHref"
        class="lares-preview__link"
        :href="downloadHref"
        download
      >{{ t("download") }}</a>
    </header>
    <div v-if="status === 'loading'" class="lares-preview__hint">{{ t("loading") }}</div>
    <div v-else-if="status === 'error'" class="lares-preview__hint">
      <p>{{ failText }}</p>
      <button type="button" class="lares-preview__link" @click="$emit('retry')">{{ t("retry") }}</button>
    </div>
    <div v-else-if="data?.kind === 'image'" class="lares-preview__media">
      <img :src="mediaSrc" :alt="name" />
    </div>
    <div v-else-if="data?.kind === 'video'" class="lares-preview__media">
      <video :src="mediaSrc" controls playsinline />
    </div>
    <div v-else-if="data?.kind === 'audio'" class="lares-preview__media">
      <audio :src="mediaSrc" controls />
    </div>
    <iframe
      v-else-if="data?.kind === 'pdf'"
      class="lares-preview__pdf"
      :src="mediaSrc"
      :title="name"
    />
    <div
      v-else-if="data?.kind === 'markdown'"
      class="lares-preview__markdown"
      v-html="renderMarkdown(data.text)"
    />
    <pre v-else-if="data?.kind === 'text'" class="lares-preview__text">{{ data.text }}</pre>
    <div v-else class="lares-preview__hint">
      <p>{{ t("unsupportedTitle") }}</p>
      <p>{{ t("unsupported") }}</p>
    </div>
    <p v-if="data?.truncated" class="lares-preview__hint">{{ t("truncated") }}</p>
  </div>
</template>

<script>
import { fileName } from "@lares/core/files/preview-workspace";
import { messageFromCode } from "@lares/core/i18n/t";
import { renderMarkdown } from "../chat/markdown.js";

export default {
  name: "LaresPreview",
  props: {
    path: { type: String, required: true },
    status: { type: String, default: "loading" },
    data: { type: Object, default: null },
    error: { type: String, default: "" },
    mediaSrc: { type: String, default: "" },
    downloadHref: { type: String, default: "" },
    t: { type: Function, required: true },
  },
  computed: {
    name() {
      return this.data?.name || fileName(this.path);
    },
    failText() {
      return messageFromCode(this.t, this.error, "failed");
    },
  },
  methods: { renderMarkdown },
};
</script>

<style scoped>
.lares-preview {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  background: var(--q-background-1);
  color: var(--q-ink-1);
}

.lares-preview__bar {
  display: flex;
  gap: 8px;
  align-items: center;
  height: 56px;
  padding: 0 12px;
}

.lares-preview__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 16px;
  font-weight: 500;
}

.lares-preview__back,
.lares-preview__link {
  border: 0;
  background: none;
  font: inherit;
  color: var(--q-blue-default);
  text-decoration: none;
}

.lares-preview__hint,
.lares-preview__text,
.lares-preview__markdown {
  margin: 0;
  padding: 12px 20px;
  font-size: 14px;
  color: var(--q-ink-2);
}

.lares-preview__text,
.lares-preview__markdown {
  flex: 1;
  overflow: auto;
  color: var(--q-ink-1);
}

.lares-preview__text {
  white-space: pre-wrap;
  word-break: break-word;
}

.lares-preview__media,
.lares-preview__pdf {
  flex: 1;
  min-height: 0;
}

.lares-preview__media img,
.lares-preview__media video,
.lares-preview__pdf {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  border: 0;
}

.lares-preview__media audio {
  width: 100%;
  margin-top: 24px;
}
</style>
