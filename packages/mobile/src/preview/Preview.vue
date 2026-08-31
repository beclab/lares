<template>
  <Teleport to="body">
    <div class="lares-preview" role="dialog" aria-modal="true" :aria-label="t('preview')">
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
        v-html="markdownHtml"
        @click="onMarkdownClick"
      />
      <pre v-else-if="data?.kind === 'text'" class="lares-preview__text">{{ data.text }}</pre>
      <div v-else-if="data?.kind === 'model3d'" class="lares-preview__hint">
        <p>{{ t("model3dHint") }}</p>
      </div>
      <div v-else class="lares-preview__hint">
        <p>{{ t("unsupportedTitle") }}</p>
        <p>{{ t("unsupported") }}</p>
      </div>
      <p v-if="data?.truncated" class="lares-preview__hint">{{ t("truncated") }}</p>
    </div>
  </Teleport>
</template>

<script>
import { fileName, workspaceLinkClickPath } from "@olares/lares-core/files/preview-workspace";
import { rewriteWorkspaceTargets } from "@olares/lares-core/files/markdown";
import { messageFromCode } from "@olares/lares-core/i18n/t";
import { renderMarkdown } from "../chat/markdown.js";

export default {
  name: "LaresPreview",
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
    failText() {
      return messageFromCode(this.t, this.error, "failed");
    },
    markdownHtml() {
      const text = this.data?.text ?? "";
      const rewritten = this.hrefFor
        ? rewriteWorkspaceTargets(text, this.data?.path ?? this.path, this.hrefFor)
        : text;
      return renderMarkdown(rewritten);
    },
  },
  methods: {
    onMarkdownClick(event) {
      if (!this.sessionId) return;
      const path = workspaceLinkClickPath(this.sessionId, event);
      if (path === null) return;
      event.preventDefault();
      this.$emit("open", path);
    },
  },
};
</script>

<style scoped>
.lares-preview {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  background: var(--q-background-1);
  color: var(--q-ink-1);
}

.lares-preview__bar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
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
  min-height: 0;
  overflow: auto;
  color: var(--q-ink-1);
}

.lares-preview__text {
  white-space: pre-wrap;
  word-break: break-word;
}

.lares-preview__markdown :deep(p),
.lares-preview__markdown :deep(pre) {
  margin: 0 0 10px;
}

.lares-preview__markdown :deep(ul),
.lares-preview__markdown :deep(ol) {
  margin: 4px 0 12px;
  padding: 0 0 0 1.35em;
}

.lares-preview__markdown :deep(ul) {
  list-style: disc outside;
}

.lares-preview__markdown :deep(ol) {
  list-style: decimal outside;
}

.lares-preview__markdown :deep(li + li) {
  margin-top: 6px;
}

.lares-preview__markdown :deep(img) {
  max-width: 100%;
  height: auto;
}

.lares-preview__media {
  display: grid;
  flex: 1;
  min-width: 0;
  min-height: 0;
  place-items: center;
  overflow: auto;
  padding: 16px 20px;
}

.lares-preview__media img,
.lares-preview__media video {
  max-width: 100%;
  max-height: 100%;
  min-width: 0;
  min-height: 0;
  border-radius: 10px;
  object-fit: contain;
}

.lares-preview__pdf {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: 0;
}

.lares-preview__media audio {
  width: min(100%, 520px);
}
</style>
