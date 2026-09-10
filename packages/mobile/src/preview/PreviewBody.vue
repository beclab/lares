<template>
  <div class="lares-preview-body">
    <div v-if="status === 'loading'" class="lares-preview-body__hint">{{ t("loading") }}</div>
    <div v-else-if="status === 'error'" class="lares-preview-body__hint">
      <p>{{ failText }}</p>
      <button type="button" class="lares-preview-body__retry" @click="$emit('retry')">{{ t("retry") }}</button>
    </div>
    <div v-else-if="data?.kind === 'image'" class="lares-preview-body__media">
      <img :src="mediaSrc" :alt="name" />
    </div>
    <div v-else-if="data?.kind === 'video'" class="lares-preview-body__media">
      <video :src="mediaSrc" controls playsinline />
    </div>
    <div v-else-if="data?.kind === 'audio'" class="lares-preview-body__media">
      <audio :src="mediaSrc" controls />
    </div>
    <iframe
      v-else-if="data?.kind === 'pdf'"
      class="lares-preview-body__pdf"
      :src="mediaSrc"
      :title="name"
    />
    <div
      v-else-if="data?.kind === 'markdown'"
      class="lares-preview-body__markdown"
      v-html="markdownHtml"
      @click="onMarkdownClick"
    />
    <pre v-else-if="data?.kind === 'text'" class="lares-preview-body__text">{{ data.text }}</pre>
    <div v-else-if="data?.kind === 'model3d'" class="lares-preview-body__hint">
      <p>{{ t("model3dHint") }}</p>
    </div>
    <div v-else class="lares-preview-body__hint">
      <p>{{ t("unsupportedTitle") }}</p>
      <p>{{ t("unsupported") }}</p>
    </div>
    <p v-if="data?.truncated" class="lares-preview-body__hint">{{ t("truncated") }}</p>
  </div>
</template>

<script>
import { fileName } from "@olares/lares-core/files/filename";
import { workspaceLinkClickPath } from "@olares/lares-core/files/preview-workspace";
import { rewriteWorkspaceTargets } from "@olares/lares-core/files/markdown";
import { messageFromCode } from "@olares/lares-core/i18n/t";
import { renderMarkdown } from "../chat/markdown.js";

export default {
  name: "LaresPreviewBody",
  props: {
    path: { type: String, required: true },
    sessionId: { type: String, default: "" },
    status: { type: String, default: "loading" },
    data: { type: Object, default: null },
    error: { type: String, default: "" },
    mediaSrc: { type: String, default: "" },
    hrefFor: { type: Function, default: null },
    t: { type: Function, required: true },
  },
  emits: ["retry", "open"],
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
.lares-preview-body {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.lares-preview-body__hint,
.lares-preview-body__text,
.lares-preview-body__markdown {
  margin: 0;
  padding: 12px 20px;
  color: var(--q-ink-2);
  font-size: 16px;
}

.lares-preview-body__retry {
  border: 0;
  background: none;
  color: var(--q-blue-default);
  cursor: pointer;
  font: inherit;
}

.lares-preview-body__text,
.lares-preview-body__markdown {
  min-height: 0;
  flex: 1;
  overflow: auto;
  color: var(--q-ink-1);
}

.lares-preview-body__text {
  white-space: pre-wrap;
  word-break: break-word;
}

.lares-preview-body__markdown :deep(p),
.lares-preview-body__markdown :deep(pre) {
  margin: 0 0 10px;
}

.lares-preview-body__markdown :deep(ul),
.lares-preview-body__markdown :deep(ol) {
  margin: 4px 0 12px;
  padding: 0 0 0 1.35em;
}

.lares-preview-body__markdown :deep(ul) {
  list-style: disc outside;
}

.lares-preview-body__markdown :deep(ol) {
  list-style: decimal outside;
}

.lares-preview-body__markdown :deep(li + li) {
  margin-top: 6px;
}

.lares-preview-body__markdown :deep(img) {
  max-width: 100%;
  height: auto;
}

.lares-preview-body__media {
  display: grid;
  min-width: 0;
  min-height: 0;
  flex: 1;
  place-items: center;
  overflow: auto;
  padding: 16px 20px;
}

.lares-preview-body__media img,
.lares-preview-body__media video {
  min-width: 0;
  min-height: 0;
  max-width: 100%;
  max-height: 100%;
  border-radius: 10px;
  object-fit: contain;
}

.lares-preview-body__media audio {
  width: min(100%, 520px);
}

.lares-preview-body__pdf {
  min-height: 0;
  flex: 1;
  width: 100%;
  border: 0;
}
</style>
