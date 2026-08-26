<template>
  <div class="lares-shell">
    <p v-if="failed" class="lares-shell__status" data-status="error">
      {{ failText }}
    </p>
    <button
      v-if="failed"
      type="button"
      class="lares-shell__retry"
      :disabled="starting"
      @click="retry"
    >
      {{ t("probe.retry") }}
    </button>
    <ol ref="log" class="lares-shell__log" aria-live="polite" @scroll.passive="onLogScroll">
      <li v-if="viewItems.length === 0 && !running" class="lares-shell__empty">
        {{ t("chat.empty") }}
      </li>
      <li
        v-for="(row, index) in viewItems"
        :key="index"
        class="lares-shell__item"
        :data-type="row.type"
        :data-pending="row.pending ? 'true' : 'false'"
      >
        <div v-if="row.type === 'user'" class="lares-shell__msg" data-role="user">{{ row.text }}</div>
        <details v-else-if="row.type === 'reasoning'" class="lares-shell__think" :open="row.running">
          <summary>{{ row.running ? t("chat.thinking") : t("chat.thinkingDone") }}</summary>
          <pre>{{ row.text }}</pre>
        </details>
        <article v-else-if="row.type === 'tool'" class="lares-shell__tool" :data-status="row.status">
          <strong>{{ toolLabel(row) }}</strong>
          <p v-if="row.detail">{{ row.detail }}</p>
        </article>
        <div v-else-if="row.type === 'assistant'" class="lares-shell__msg" data-role="assistant">{{ row.text }}</div>
        <section v-else-if="row.type === 'files'" class="lares-shell__files" :aria-label="t('produced')">
          <p v-if="fileGroup(row.paths).loading" class="lares-shell__hint">{{ t("mediaLoading") }}</p>
          <figure v-for="item in fileGroup(row.paths).media" :key="item.path" class="lares-shell__media">
            <img
              v-if="item.kind === 'image'"
              :src="runtime.mediaUrl(item.path, item.modifiedAt)"
              :alt="item.name"
              @load="onLogMedia"
              @click="openFile(item.path)"
            />
            <video
              v-else-if="item.kind === 'video'"
              :src="runtime.mediaUrl(item.path, item.modifiedAt)"
              controls
              playsinline
            />
            <audio
              v-else
              :src="runtime.mediaUrl(item.path, item.modifiedAt)"
              controls
            />
            <figcaption>
              <button type="button" @click="openFile(item.path)">{{ item.name }}</button>
            </figcaption>
          </figure>
          <button
            v-for="path in fileGroup(row.paths).files"
            :key="path"
            type="button"
            class="lares-shell__chip"
            @click="openFile(path)"
          >
            {{ fileName(path) }}
          </button>
        </section>
      </li>
    </ol>
    <p v-if="running" class="lares-shell__hint">{{ t("chat.sending") }}</p>
    <form class="lares-shell__composer" @submit.prevent="send">
      <textarea
        v-model="draft"
        class="lares-shell__input"
        rows="2"
        :placeholder="t('chat.placeholder')"
        :disabled="sending"
        @keydown.enter.exact.prevent="send"
      />
      <button type="submit" class="lares-shell__retry" :disabled="sending || !canSend">
        {{ t("chat.send") }}
      </button>
    </form>
    <LaresPreview
      v-if="preview.path"
      :path="preview.path"
      :status="preview.status"
      :data="preview.data"
      :error="preview.error"
      :media-src="previewMediaSrc"
      :download-href="previewDownloadHref"
      :t="t"
      @close="closePreview"
      @retry="openFile(preview.path)"
    />
  </div>
</template>

<script>
import { t as translate } from "@lares/core/i18n/t";
import { EN, ZH } from "@lares/core/i18n/mobile";
import { EN as PREVIEW_EN, ZH as PREVIEW_ZH } from "@lares/core/i18n/preview";
import { partitionPreviews } from "@lares/core/files/preview-groups";
import { fileName } from "@lares/core/files/preview-workspace";
import { connectChat } from "./runtime.js";
import LaresPreview from "./Preview.vue";

const catalog = {
  zh: { ...PREVIEW_ZH, ...ZH },
  en: { ...PREVIEW_EN, ...EN },
};

export default {
  name: "LaresApp",
  components: { LaresPreview },
  props: {
    locale: { type: String, default: "en" },
    baseUrl: { type: String, default: undefined },
    proxyPrefix: { type: String, default: undefined },
    request: { type: Function, default: undefined },
    env: { type: Object, default: undefined },
  },
  data() {
    return {
      sending: false,
      starting: false,
      running: false,
      sessionId: "",
      draft: "",
      failed: "",
      error: "",
      items: [],
      pendingUser: "",
      unsub: null,
      previews: {},
      preview: { path: "", status: "idle", data: null, error: "" },
      applyingScroll: false,
      logRo: null,
    };
  },
  computed: {
    ports() {
      return {
        baseUrl: this.baseUrl,
        proxyPrefix: this.proxyPrefix,
        request: this.request,
        env: this.env,
      };
    },
    runtime() {
      return connectChat(this.ports);
    },
    canSend() {
      return Boolean(this.draft.trim()) && Boolean(this.sessionId) && !this.running;
    },
    viewItems() {
      if (!this.pendingUser) return this.items;
      const last = [...this.items].reverse().find((row) => row.type === "user");
      if (last?.text === this.pendingUser) return this.items;
      return [...this.items, { type: "user", text: this.pendingUser }];
    },
    failText() {
      if (this.failed === "unauthorized") return this.t("chat.unauthorized");
      if (this.failed === "missing" || this.failed === "unreachable" || this.failed === "error") {
        return this.t(`probe.${this.failed}`, { http: "", error: "" });
      }
      return this.t("chat.failed", { error: this.failed || this.error });
    },
    previewMediaSrc() {
      const data = this.preview.data;
      if (!data) return "";
      return this.runtime.mediaUrl(data.path, data.modifiedAt);
    },
    previewDownloadHref() {
      if (!this.preview.path) return "";
      return this.runtime.downloadUrl(this.preview.path);
    },
    filePaths() {
      return this.items.filter((row) => row.type === "files").flatMap((row) => row.paths);
    },
  },
  watch: {
    filePaths: {
      immediate: true,
      handler(paths) {
        this.hydrateFiles(paths);
      },
    },
  },
  created() {
    this.unsub = this.runtime.subscribe((snap) => this.applySnap(snap));
  },
  mounted() {
    this.retry();
    this.bindLog();
    this.restoreLog();
  },
  activated() {
    this.restoreLog();
  },
  deactivated() {
    this.captureLog();
  },
  beforeUnmount() {
    this.captureLog();
    this.unbindLog();
    this.unsub?.();
    this.unsub = null;
  },
  methods: {
    fileName,
    t(key, params) {
      return translate(catalog, this.locale, key, params);
    },
    fileGroup(paths) {
      return partitionPreviews(paths, new Map(Object.entries(this.previews)));
    },
    toolLabel(row) {
      const name = row.title || row.name;
      if (row.status === "running") return this.t("chat.toolRunning", { name });
      if (row.status === "error") return this.t("chat.toolError", { name });
      return this.t("chat.toolDone", { name });
    },
    applySnap(snap) {
      this.sessionId = snap.sessionId;
      this.items = snap.items;
      this.running = snap.running;
      this.failed = snap.failed;
      this.error = snap.error;
      if (this.pendingUser && snap.items.some((row) => row.type === "user" && row.text === this.pendingUser)) {
        this.pendingUser = "";
      }
      if (this.runtime.sticking()) this.restoreLog();
    },
    onLogMedia() {
      if (this.runtime.sticking()) this.restoreLog();
    },
    captureLog() {
      if (this.applyingScroll) return;
      const log = this.$refs.log;
      if (!log) return;
      this.runtime.rememberScroll(log.scrollTop, log.scrollHeight, log.clientHeight);
    },
    onLogScroll() {
      this.captureLog();
    },
    bindLog() {
      const log = this.$refs.log;
      if (!log || this.logRo) return;
      this.logRo = new ResizeObserver(() => this.applyLogScroll());
      this.logRo.observe(log);
    },
    unbindLog() {
      this.logRo?.disconnect();
      this.logRo = null;
    },
    applyLogScroll() {
      const log = this.$refs.log;
      if (!log) return;
      const top = this.runtime.scrollTop(log.scrollHeight, log.clientHeight);
      if (top == null) return;
      this.applyingScroll = true;
      log.scrollTop = top;
      requestAnimationFrame(() => {
        this.applyingScroll = false;
      });
    },
    restoreLog() {
      this.$nextTick(() => {
        this.bindLog();
        this.applyLogScroll();
        requestAnimationFrame(() => this.applyLogScroll());
      });
    },
    async hydrateFiles(paths) {
      const missing = [...new Set(paths)].filter((path) => !(path in this.previews));
      if (!missing.length) return;
      const next = { ...this.previews };
      await Promise.all(missing.map(async (path) => {
        try {
          next[path] = await this.runtime.preview(path);
        } catch {
          next[path] = null;
        }
      }));
      this.previews = next;
      if (this.runtime.sticking()) this.restoreLog();
    },
    async openFile(path) {
      this.preview = { path, status: "loading", data: null, error: "" };
      try {
        const data = await this.runtime.preview(path);
        this.previews = { ...this.previews, [path]: data };
        this.preview = { path, status: "ready", data, error: "" };
      } catch (err) {
        this.preview = {
          path,
          status: "error",
          data: null,
          error: err instanceof Error ? err.message : "file_preview_failed",
        };
      }
    },
    closePreview() {
      this.preview = { path: "", status: "idle", data: null, error: "" };
    },
    async retry() {
      this.starting = true;
      try {
        await this.runtime.start();
      } finally {
        this.starting = false;
      }
    },
    async send() {
      const text = this.draft.trim();
      if (!this.canSend) return;
      this.sending = true;
      this.draft = "";
      this.pendingUser = text;
      this.runtime.pinToBottom();
      this.restoreLog();
      try {
        const sent = await this.runtime.send(text);
        if (!sent.ok) {
          this.pendingUser = "";
          this.draft = text;
          this.failed = sent.error?.message || sent.error?.code || "send";
        }
      } finally {
        this.sending = false;
      }
    },
  },
};
</script>

<style scoped>
.lares-shell {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  flex: 1;
  padding: 12px 16px 20px;
}

.lares-shell__status,
.lares-shell__hint,
.lares-shell__empty {
  margin: 0;
}

.lares-shell__hint,
.lares-shell__empty {
  font-size: 12px;
  opacity: 0.56;
}

.lares-shell__status[data-status="error"] {
  color: #b45309;
}

.lares-shell__log {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  min-height: 0;
  flex: 1;
  overflow: auto;
  list-style: none;
}

.lares-shell__item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lares-shell__msg {
  max-width: 86%;
  border-radius: 16px;
  padding: 8px 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

.lares-shell__msg[data-role="user"] {
  align-self: flex-end;
  background: rgba(99, 102, 241, 0.16);
}

.lares-shell__msg[data-role="assistant"] {
  align-self: flex-start;
  background: rgba(15, 23, 42, 0.08);
}

.lares-shell__item[data-pending="true"] .lares-shell__msg {
  opacity: 0.72;
}

.lares-shell__think,
.lares-shell__tool {
  align-self: flex-start;
  max-width: 92%;
  border-radius: 12px;
  padding: 8px 10px;
  background: rgba(15, 23, 42, 0.05);
  font-size: 13px;
}

.lares-shell__think pre,
.lares-shell__tool p {
  margin: 8px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  font: inherit;
  opacity: 0.78;
}

.lares-shell__think summary {
  cursor: pointer;
}

.lares-shell__tool[data-status="running"] {
  opacity: 0.78;
}

.lares-shell__files {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-start;
}

.lares-shell__media {
  margin: 0;
  max-width: 220px;
}

.lares-shell__media img,
.lares-shell__media video {
  display: block;
  width: 100%;
  border-radius: 12px;
}

.lares-shell__media figcaption,
.lares-shell__chip {
  margin-top: 4px;
}

.lares-shell__chip,
.lares-shell__media button {
  border: 0;
  border-radius: 999px;
  padding: 6px 10px;
  font: inherit;
  color: inherit;
  background: rgba(99, 102, 241, 0.12);
}

.lares-shell__composer {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.lares-shell__input {
  flex: 1;
  resize: none;
  border: 0;
  border-radius: 12px;
  padding: 8px 10px;
  font: inherit;
  color: inherit;
  background: rgba(15, 23, 42, 0.06);
}

.lares-shell__retry {
  align-self: flex-end;
  border: 0;
  border-radius: 999px;
  padding: 8px 14px;
  font: inherit;
  color: inherit;
  background: rgba(99, 102, 241, 0.16);
}

.lares-shell__retry:disabled {
  opacity: 0.5;
}
</style>
