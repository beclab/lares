<template>
  <div class="lares-shell">
    <LaresChatBar
      :t="t"
      :title="sessionTitle"
      :starting="starting"
      @history="toggleHistory"
      @create="newChat"
    />
    <LaresHistoryPanel
      :open="panel === 'history'"
      :sessions="sessions"
      :session-id="sessionId"
      :ready="sessionsReady"
      :t="t"
      @close="panel = ''"
      @pick="pickSession"
    />
    <p v-if="failed" class="lares-shell__status">{{ failText }}</p>
    <button v-if="failed" type="button" class="lares-shell__retry" :disabled="starting" @click="retry">
      {{ t("probe.retry") }}
    </button>
    <LaresTranscript
      ref="transcript"
      :items="viewItems"
      :running="running"
      :loading="historyLoading || starting"
      :previews="previews"
      :media-url="mediaUrl"
      :scroll-top="scrollTop"
      :remember-scroll="rememberScroll"
      :sticking="sticking"
      :session-id="sessionId"
      :question="question"
      :question-busy="questionBusy"
      :t="t"
      @open="openFile"
      @media="pinLog"
      @answer="answerQuestion"
    />
    <LaresComposer
      :draft="draft"
      :sending="sending"
      :can-send="canSend"
      :model-label="modelLabel"
      :model-busy="modelBusy"
      :effort-label="effortLabel"
      :effort-disabled="effortDisabled"
      :attach-pending="upload.pending > 0"
      :attach-disabled="!sessionId || historyLoading || starting"
      :voice-phase="voicePhase"
      :voice-elapsed="voiceElapsed"
      :voice-error="voiceErrorText"
      :failures="upload.failures"
      :t="t"
      @update:draft="draft = $event"
      @send="send"
      @model="openModelSheet"
      @effort="openEffortSheet"
      @files="attachFiles"
      @voice="toggleVoice"
      @hold-start="onHoldStart"
      @hold-end="onHoldEnd"
    />
    <LaresSheet :open="modelSheet" :title="t('model.menuAria')" @close="modelSheet = false">
      <p v-if="modelError" class="lares-shell__status">{{ modelError }}</p>
      <p v-else-if="!models" class="lares-shell__hint">{{ t("agent.loading") }}</p>
      <p v-else-if="!modelGroups.length" class="lares-shell__hint">{{ t("model.empty") }}</p>
      <template v-for="section in modelGroups" :key="section.provider">
        <p class="lares-shell__heading">{{ section.provider }}</p>
        <LaresSettingRow
          v-for="item in section.models"
          :key="modelKey(item)"
          :label="item.name"
          :checked="modelKey(item) === modelCurrent"
          :disabled="modelBusy"
          @click="chooseModel(item)"
        />
      </template>
    </LaresSheet>
    <LaresSheet :open="effortSheet" :title="t('reasoning.title')" @close="effortSheet = false">
      <p v-if="!effortRows.length" class="lares-shell__hint">{{ t("reasoning.default") }}</p>
      <LaresSettingRow
        v-for="row in effortRows"
        :key="row.key"
        :label="effortName(row)"
        :checked="row.id === effortId"
        :disabled="modelBusy"
        @click="chooseEffort(row.id)"
      />
    </LaresSheet>
    <LaresPreview
      v-if="preview.path"
      :path="preview.path"
      :session-id="sessionId"
      :status="preview.status"
      :data="preview.data"
      :error="preview.error"
      :media-src="previewMediaSrc"
      :download-href="previewDownloadHref"
      :href-for="previewHref"
      :t="t"
      @close="closePreview"
      @retry="openFile(preview.path)"
      @open="openFile"
    />
  </div>
</template>

<script>
import { connectChat } from "./runtime.js";
import { createT } from "./i18n.js";
import { failText, withPendingUser } from "./chat/format.js";
import { createVoiceCapture } from "./chat/voice.js";
import { appendDraftMentions } from "@olares/lares-core/files/mention";
import { FileIntake, partitionDocumentsBySize } from "@olares/lares-core/files/intake";
import { DEFAULT_MAX_UPLOAD_BYTES } from "@olares/lares-core/files/limits";
import { groupModelsByProvider, effortMenuRows, reasoningOfModel, currentEffortId, selectionKey } from "@olares/lares-core/router/session-model";
import { messageFromCode } from "@olares/lares-core/i18n/t";
import { parseAskUserQuestions, singleSelectAnswer } from "@olares/lares-core/larepass/questions";
import LaresChatBar from "./chat/ChatBar.vue";
import LaresHistoryPanel from "./chat/HistoryPanel.vue";
import LaresTranscript from "./chat/Transcript.vue";
import LaresComposer from "./chat/Composer.vue";
import LaresPreview from "./preview/Preview.vue";
import LaresSheet from "./settings/Sheet.vue";
import LaresSettingRow from "./settings/SettingRow.vue";
import "./styles.css";

export default {
  name: "LaresApp",
  components: { LaresChatBar, LaresHistoryPanel, LaresTranscript, LaresComposer, LaresPreview, LaresSheet, LaresSettingRow },
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
      panel: "",
      sessions: [],
      sessionsReady: false,
      historyLoading: false,
      models: null,
      modelError: "",
      modelPending: "",
      modelSheet: false,
      effortSheet: false,
      effortByModel: {},
      upload: { pending: 0, failures: [] },
      voicePhase: "idle",
      voiceElapsed: 0,
      voiceError: "",
      voiceLanguage: "",
      intakeUnsub: null,
      question: null,
      questionBusy: false,
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
    t() {
      return createT(this.locale);
    },
    canSend() {
      return Boolean(this.draft.trim()) && Boolean(this.sessionId) && !this.running && !this.historyLoading && this.upload.pending === 0;
    },
    sessionTitle() {
      const row = this.sessions.find((item) => item.sessionId === this.sessionId);
      return row?.title || this.t("history.untitled");
    },
    currentListedModel() {
      for (const group of this.modelGroups) {
        for (const model of group.models) {
          if (this.modelKey(model) === this.modelCurrent) return model;
        }
      }
      return null;
    },
    modelLabel() {
      return this.currentListedModel?.name || this.models?.default?.model || this.t("model.select");
    },
    reasoning() {
      return reasoningOfModel(this.currentListedModel);
    },
    effortId() {
      if (!(this.modelCurrent in this.effortByModel)) {
        return currentEffortId(this.models?.default, this.reasoning);
      }
      const stored = this.effortByModel[this.modelCurrent];
      return stored === "" ? undefined : stored;
    },
    effortLabel() {
      return this.effortName({ id: this.effortId, name: this.effortId });
    },
    effortDisabled() {
      return !this.reasoning;
    },
    effortRows() {
      return effortMenuRows(this.reasoning, this.t("reasoning.default"));
    },
    viewItems() {
      return withPendingUser(this.items, this.pendingUser);
    },
    failText() {
      return failText(this.t, this.failed, this.error);
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
    previewHref() {
      return (path) => {
        const href = this.runtime.mediaUrl(path);
        try {
          return new URL(href, globalThis.location?.origin || "http://localhost").href;
        } catch {
          return href;
        }
      };
    },
    filePaths() {
      return this.items.filter((row) => row.type === "files").flatMap((row) => row.paths);
    },
    modelGroups() {
      return groupModelsByProvider(this.models?.models ?? []);
    },
    modelCurrent() {
      return this.models?.default ? selectionKey(this.models.default) : "";
    },
    modelBusy() {
      return Boolean(this.modelPending) || (this.modelSheet && !this.models);
    },
    voiceErrorText() {
      return this.voiceError ? messageFromCode(this.t, this.voiceError, "error.voice_failed") : "";
    },
  },
  watch: {
    filePaths: {
      immediate: true,
      handler(paths) {
        this.hydrateFiles(paths);
      },
    },
    sessionId(id) {
      this.bindIntake(id);
    },
  },
  created() {
    this.intake = new FileIntake((file, sessionId, options) => this.runtime.upload(file, options, sessionId));
    this.voiceCap = createVoiceCapture({
      transcribe: (blob, signal) => this.runtime.transcribe(blob, this.voiceLanguage, signal),
      getDraft: () => this.draft,
      setDraft: (text) => {
        this.draft = text;
      },
      onPhase: (phase, extra = {}) => {
        this.voicePhase = phase;
        if (extra.elapsed != null) this.voiceElapsed = extra.elapsed;
        if (extra.error != null) this.voiceError = extra.error;
      },
    });
    this.bindIntake(this.sessionId);
    this.unsub = this.runtime.subscribe((snap) => this.applySnap(snap));
    try {
      const raw = JSON.parse(localStorage.getItem("lares.mobile.effort") || "{}");
      if (raw && typeof raw === "object") this.effortByModel = raw;
    } catch {
      this.effortByModel = {};
    }
  },
  mounted() {
    this.retry();
  },
  activated() {
    this.restoreLog();
  },
  deactivated() {
    this.captureLog();
  },
  beforeUnmount() {
    this.captureLog();
    this.voiceCap?.dispose();
    this.intakeUnsub?.();
    if (this.sessionId) this.intake?.cancelSession(this.sessionId);
    this.unsub?.();
    this.unsub = null;
  },
  methods: {
    mediaUrl(item) {
      return this.runtime.mediaUrl(item.path, item.modifiedAt);
    },
    scrollTop(height, view) {
      return this.runtime.scrollTop(height, view);
    },
    rememberScroll(top, height, view) {
      this.runtime.rememberScroll(top, height, view);
    },
    sticking() {
      return this.runtime.sticking();
    },
    restoreLog() {
      this.$refs.transcript?.restoreLog?.();
    },
    captureLog() {
      this.$refs.transcript?.captureLog?.();
    },
    pinLog() {
      this.$refs.transcript?.scheduleLogPin?.();
    },
    applySnap(snap) {
      if (snap.sessionId !== this.sessionId) {
        this.pendingUser = "";
        this.previews = {};
      }
      this.sessionId = snap.sessionId;
      this.items = snap.items;
      this.running = snap.running;
      this.failed = snap.failed;
      this.error = snap.error;
      this.sessions = snap.sessions ?? this.sessions;
      this.sessionsReady = Boolean(snap.sessionsReady);
      this.historyLoading = Boolean(snap.historyLoading);
      this.question = snap.question || null;
      if (!this.question) this.questionBusy = false;
      if (this.pendingUser && snap.items.some((row) => row.type === "user" && row.text === this.pendingUser)) {
        this.pendingUser = "";
      }
      this.pinLog();
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
      this.pinLog();
    },
    async answerQuestion(label, row) {
      const questions = this.question?.questions?.length
        ? this.question.questions
        : parseAskUserQuestions(row?.argsRaw);
      const id = questions[0]?.id;
      if (!id || this.questionBusy) return;
      this.questionBusy = true;
      try {
        const result = await this.runtime.answerQuestion(singleSelectAnswer(id, label).answers);
        if (!result?.ok) this.questionBusy = false;
      } catch {
        this.questionBusy = false;
      }
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
        await this.loadComposerMeta();
      } finally {
        this.starting = false;
      }
    },
    modelKey(model) {
      return selectionKey({ provider: model.provider, model: model.id });
    },
    bindIntake(sessionId) {
      this.intakeUnsub?.();
      this.intakeUnsub = null;
      if (!sessionId || !this.intake) {
        this.upload = { pending: 0, failures: [] };
        return;
      }
      this.upload = this.intake.getSnapshot(sessionId);
      this.intakeUnsub = this.intake.subscribe(sessionId, () => {
        this.upload = this.intake.getSnapshot(sessionId);
      });
    },
    async loadComposerMeta() {
      const settings = this.runtime.settings;
      if (!settings) return;
      try {
        this.models = await settings.models();
        this.modelError = "";
      } catch (err) {
        this.modelError = err instanceof Error ? err.message : String(err);
      }
      try {
        const voice = await settings.voice();
        this.voiceLanguage = voice.config?.language || "";
      } catch {
        this.voiceLanguage = "";
      }
    },
    openEffortSheet() {
      if (this.effortDisabled) return;
      this.effortSheet = true;
    },
    effortName(row) {
      if (row?.id == null) return this.t("reasoning.default");
      const text = this.t(`effort.${row.id}`);
      return text === `effort.${row.id}` ? (row.name || row.id) : text;
    },
    persistEffort() {
      try {
        localStorage.setItem("lares.mobile.effort", JSON.stringify(this.effortByModel));
      } catch {
        // storage may be blocked
      }
    },
    chooseEffort(id) {
      this.effortSheet = false;
      if (!this.modelCurrent) return;
      this.effortByModel = { ...this.effortByModel, [this.modelCurrent]: id ?? "" };
      this.persistEffort();
    },
    openModelSheet() {
      this.modelSheet = true;
      if (!this.models) void this.loadComposerMeta();
    },
    async chooseModel(model) {
      const key = this.modelKey(model);
      if (key === this.modelCurrent || this.modelBusy) {
        this.modelSheet = false;
        return;
      }
      this.modelSheet = false;
      this.modelPending = key;
      this.modelError = "";
      try {
        this.models = await this.runtime.settings.setDefaultModel({
          provider: model.provider,
          model: model.id,
        });
      } catch (err) {
        this.modelError = err instanceof Error ? err.message : String(err);
      } finally {
        this.modelPending = "";
      }
    },
    attachFiles(files) {
      const sessionId = this.sessionId;
      if (!sessionId || !files?.length) return;
      const incoming = [...files];
      const { accepted, oversized } = partitionDocumentsBySize(incoming, DEFAULT_MAX_UPLOAD_BYTES);
      for (const file of oversized) this.intake.reportFailure(sessionId, file, "file_too_large");
      void this.intake.uploadFiles(sessionId, accepted, (paths) => {
        this.draft = appendDraftMentions(this.draft, paths);
      });
    },
    onHoldStart() {
      if (this.voicePhase === "idle" || this.voicePhase === "error") this.voiceCap?.start();
    },
    onHoldEnd() {
      if (this.voicePhase === "recording") this.voiceCap?.stop();
      else this.voiceCap?.stop(true);
    },
    toggleVoice() {
      this.voiceCap?.toggle();
    },
    toggleHistory() {
      if (this.panel === "history") {
        this.panel = "";
        return;
      }
      this.panel = "history";
      this.runtime.refreshSessions();
    },
    pickSession(sessionId) {
      this.panel = "";
      if (!sessionId || sessionId === this.sessionId) return;
      this.pendingUser = "";
      this.previews = {};
      this.runtime.openSession(sessionId);
    },
    newChat() {
      this.panel = "";
      this.pendingUser = "";
      this.previews = {};
      this.runtime.createSession();
    },
    async send() {
      const text = this.draft.trim();
      if (!this.canSend) return;
      this.sending = true;
      this.draft = "";
      this.pendingUser = text;
      this.runtime.pinToBottom();
      this.pinLog();
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
.lares-shell__status,
.lares-shell__hint {
  margin: 0 20px;
  font-size: 13px;
  color: var(--q-ink-3);
}

.lares-shell__status {
  color: var(--q-orange-default);
}

.lares-shell__retry {
  align-self: flex-start;
  margin: 0 20px;
  border: 0;
  border-radius: 8px;
  padding: 8px 12px;
  background: var(--q-blue-alpha);
  color: var(--q-blue-default);
}

.lares-shell__heading {
  margin: 0;
  padding: 12px 16px 4px;
  color: var(--q-ink-3);
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
}
</style>
