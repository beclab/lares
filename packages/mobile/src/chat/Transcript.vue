<template>
  <ol ref="log" class="lares-log" aria-live="polite" @scroll.passive="onScroll">
    <li v-if="loading && items.length === 0" class="lares-log__skeleton" role="status" :aria-label="t('chat.loading')">
      <span class="lares-sk lares-sk--user" />
      <span class="lares-sk lares-sk--line" />
      <span class="lares-sk lares-sk--line lares-sk--w72" />
      <span class="lares-sk lares-sk--line lares-sk--w40" />
      <span class="lares-sk lares-sk--user" />
      <span class="lares-sk lares-sk--line lares-sk--w88" />
      <span class="lares-sk lares-sk--line lares-sk--w56" />
    </li>
    <li v-else-if="items.length === 0 && !running" class="lares-log__empty">{{ t("chat.empty") }}</li>
    <template v-for="block in blocks" :key="block.key">
    <li v-if="block.kind === 'fold'" class="lares-log__item" data-type="process">
      <button
        type="button"
        class="lares-process"
        :data-phase="block.phase"
        :data-open="processOpen(block) ? 'true' : 'false'"
        :disabled="!block.foldable"
        :aria-expanded="processOpen(block) ? 'true' : 'false'"
        @click="toggleProcess(block.key)"
      >
        <span class="lares-process__label">{{ processLabel(block) }}</span>
        <svg v-if="block.foldable" class="lares-process__chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6.5 9 12 14.5 17.5 9" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </li>
    <li
      v-for="{ row, index } in shown(block)"
      :key="index"
      class="lares-log__item"
      :data-type="row.type"
      :data-pending="row.pending ? 'true' : 'false'"
    >
      <div v-if="row.type === 'user'" class="lares-msg" data-role="user">{{ row.text }}</div>
      <LaresStageRow
        v-else-if="row.type === 'context'"
        kind="context"
        :title="row.role === 'recall' ? stageCopy.contextRecall : stageCopy.contextInjection"
        :summary="row.label || ''"
        :body="row.text"
      />
      <LaresStageRow
        v-else-if="row.type === 'reasoning'"
        kind="think"
        :title="stageCopy.think"
        :summary="thinkSummary(row)"
        :body="row.text"
      />
      <LaresQuestionCard
        v-else-if="!questionTakeover && row.type === 'tool' && row.name === 'ask_user_question' && row.status === 'running'"
        :questions="questionItems(row)"
        :answerable="Boolean(question?.eventId)"
        :busy="questionBusy"
        :t="t"
        @pick="$emit('answer', $event, row)"
      />
      <LaresStageRow
        v-else-if="row.type === 'tool'"
        kind="tool"
        :variant="row.variant"
        :title="row.title"
        :summary="row.summary"
        :body="row.body"
      />
      <LaresStageRow
        v-else-if="row.type === 'retry'"
        kind="retry"
        :title="retryLabel(row)"
        :body="retryBody(row)"
      />
      <div
        v-else-if="row.type === 'assistant' && row.pending"
        class="lares-md"
        data-pending="true"
      >{{ row.text }}</div>
      <template v-else-if="row.type === 'assistant'">
        <div class="lares-md" v-html="renderMarkdown(row.text)" />
        <LaresMessageActions
          :text="row.text"
          :reaction="reactions[actionKey(index)] || ''"
          :metrics="row.metrics || null"
          :t="t"
          @react="setReaction(index, $event)"
        />
      </template>
        <LaresDeliverables
        v-else-if="row.type === 'files'"
        :group="fileGroup(row.paths)"
        :media-url="mediaUrl"
        :popup="popup"
        :t="t"
        @open="$emit('open', $event)"
        @media="$emit('media')"
      />
    </li>
    </template>
    <li v-if="running && !hideRunning" class="lares-log__running" data-chat-running="true">
      <span class="lares-log__sr" role="status" aria-live="polite" aria-atomic="true">{{ t("chat.deepDiving") }}</span>
      <span class="lares-log__running-text" aria-hidden="true">{{ runningText }}</span>
    </li>
  </ol>
</template>

<script>
import { partitionPreviews } from "@olares/lares-core/files/preview-groups";
import { parseAskUserQuestions } from "@olares/lares-core/larepass/questions";
import { hidesRunningClock, processFoldLabel, transcriptBlocks } from "@olares/lares-core/larepass/process-fold";
import { STAGE_COPY } from "@olares/lares-core/larepass/stage-copy";
import { retryStatus as formatRetry, runningLabel, thinkSummary } from "./format.js";
import { renderMarkdown } from "./markdown.js";
import LaresDeliverables from "./Deliverables.vue";
import LaresQuestionCard from "./QuestionCard.vue";
import LaresMessageActions from "./MessageActions.vue";
import LaresStageRow from "./StageRow.vue";

export default {
  name: "LaresTranscript",
  components: { LaresDeliverables, LaresQuestionCard, LaresMessageActions, LaresStageRow },
  props: {
    items: { type: Array, default: () => [] },
    running: { type: Boolean, default: false },
    runningSince: { type: Number, default: 0 },
    loading: { type: Boolean, default: false },
    previews: { type: Object, default: () => ({}) },
    mediaUrl: { type: Function, required: true },
    scrollTop: { type: Function, required: true },
    rememberScroll: { type: Function, required: true },
    sticking: { type: Function, required: true },
    sessionId: { type: String, default: "" },
    popup: { type: Boolean, default: false },
    question: { type: Object, default: null },
    questionBusy: { type: Boolean, default: false },
    questionTakeover: { type: Boolean, default: false },
    t: { type: Function, required: true },
  },
  emits: ["open", "media", "answer"],
  data() {
    return {
      applyingScroll: false,
      logRo: null,
      logPin: 0,
      stageCopy: STAGE_COPY,
      reactions: {},
      openFolds: {},
      now: Date.now(),
      clock: 0,
    };
  },
  computed: {
    runningText() {
      return runningLabel(this.runningSince, this.t, this.now);
    },
    blocks() {
      return transcriptBlocks(this.items, { running: this.running });
    },
    hideRunning() {
      return hidesRunningClock(this.blocks);
    },
  },
  watch: {
    sessionId() {
      this.reactions = {};
      this.openFolds = {};
    },
    running: "syncClock",
    runningSince: "syncClock",
  },
  mounted() {
    this.bindLog();
    this.restoreLog();
    this.syncClock();
  },
  beforeUnmount() {
    this.captureLog();
    this.unbindLog();
    if (this.logPin) cancelAnimationFrame(this.logPin);
    clearInterval(this.clock);
  },
  methods: {
    syncClock() {
      clearInterval(this.clock);
      this.clock = 0;
      this.now = Date.now();
      if (!this.running || !this.runningSince) return;
      this.clock = setInterval(() => {
        this.now = Date.now();
      }, 1000);
    },
    renderMarkdown,
    thinkSummary,
    shown(block) {
      if (block.kind === "fold") return this.processOpen(block) ? block.members : [];
      return [block];
    },
    processOpen(block) {
      return !block.foldable || Boolean(this.openFolds[block.key]);
    },
    processLabel(block) {
      return processFoldLabel(this.t, block);
    },
    toggleProcess(key) {
      this.openFolds = { ...this.openFolds, [key]: !this.openFolds[key] };
    },
    questionItems(row) {
      if (this.question?.questions?.length) return this.question.questions;
      return parseAskUserQuestions(row.argsRaw);
    },
    retryLabel(row) {
      return formatRetry(row);
    },
    retryBody(row) {
      const copy = STAGE_COPY.retry;
      const lines = [];
      if (row.delayMs != null) lines.push(`${copy.delay}${Math.round(row.delayMs)}ms`);
      if (row.failure?.message) lines.push(`${copy.failure}${row.failure.message}`);
      return lines.join("\n");
    },
    fileGroup(paths) {
      return partitionPreviews(paths, new Map(Object.entries(this.previews)));
    },
    actionKey(index) {
      let n = 0;
      for (let i = 0; i <= index; i++) {
        if (this.items[i]?.type === "assistant") n += 1;
      }
      return String(n);
    },
    setReaction(index, next) {
      this.reactions = { ...this.reactions, [this.actionKey(index)]: next };
    },
    captureLog() {
      if (this.applyingScroll) return;
      const log = this.$refs.log;
      if (!log) return;
      this.rememberScroll(log.scrollTop, log.scrollHeight, log.clientHeight);
    },
    onScroll() {
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
      const top = this.scrollTop(log.scrollHeight, log.clientHeight);
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
      });
    },
    scheduleLogPin() {
      if (!this.sticking() || this.logPin) return;
      this.logPin = requestAnimationFrame(() => {
        this.logPin = 0;
        this.applyLogScroll();
      });
    },
  },
};
</script>

<style scoped>
.lares-log {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 8px 20px 12px;
  min-height: 0;
  flex: 1;
  overflow-x: hidden;
  overflow-y: auto;
  list-style: none;
}

.lares-log__empty {
  margin: 24px 0 0;
  font-size: 15px;
  color: var(--q-ink-3);
}

.lares-log__skeleton {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 8px;
}

.lares-sk {
  display: block;
  border-radius: 10px;
  background: var(--q-background-3);
  animation: lares-sk-pulse 1.2s ease-in-out infinite;
}

.lares-sk--user {
  align-self: flex-end;
  width: 42%;
  height: 36px;
  border-radius: 16px 16px 4px 16px;
  background: var(--q-blue-alpha);
}

.lares-sk--line {
  width: 100%;
  height: 14px;
  border-radius: 7px;
}

.lares-sk--w88 { width: 88%; }
.lares-sk--w72 { width: 72%; }
.lares-sk--w56 { width: 56%; }
.lares-sk--w40 { width: 40%; }

@keyframes lares-sk-pulse {
  50% { opacity: 0.45; }
}

@media (prefers-reduced-motion: reduce) {
  .lares-sk,
  .lares-log__running-text,
  .lares-process[data-phase="live"] .lares-process__label,
  .lares-log__item[data-pending="true"] {
    animation: none;
  }
}

.lares-log__running {
  margin-top: 4px;
  font-size: 14px;
  line-height: 20px;
}

.lares-log__running-text {
  color: var(--q-blue-default);
  animation: lares-running-shimmer 1.6s ease-in-out infinite;
}

@keyframes lares-running-shimmer {
  50% { opacity: 0.5; }
}

.lares-log__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.lares-log__item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
}

.lares-process {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 33px;
  border: 0;
  border-bottom: 0.5px solid var(--q-separator);
  padding: 0 0 8px;
  background: transparent;
  color: var(--q-ink-3);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.lares-process:disabled {
  cursor: default;
}

.lares-process[data-phase="live"],
.lares-process[data-phase="summary"] {
  min-height: 0;
  border-bottom: 0;
  padding: 0;
}

.lares-process[data-phase="live"] .lares-process__label {
  animation: lares-running-shimmer 1.6s ease-in-out infinite;
}

@media (hover: hover) {
  .lares-process:hover:not(:disabled) {
    color: var(--q-ink-2);
  }
}

.lares-process__label {
  min-width: 0;
  overflow: hidden;
  font-size: 14px;
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lares-process__chevron {
  flex: none;
  width: 14px;
  height: 14px;
  margin-left: 4px;
  transition: transform 0.1s;
}

.lares-process[data-open="true"] .lares-process__chevron {
  transform: rotate(180deg);
}

@media (prefers-reduced-motion: reduce) {
  .lares-process__chevron {
    transition: none;
  }
}

.lares-log__item[data-pending="true"] {
  animation: lares-msg-in var(--lares-duration-normal, 220ms) var(--lares-ease-out, cubic-bezier(0.32, 0.72, 0, 1));
}

@keyframes lares-msg-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}

.lares-log__item[data-type="user"],
.lares-log__item[data-type="assistant"],
.lares-log__item[data-type="files"] {
  margin-top: 8px;
}

.lares-msg[data-role="user"] {
  align-self: flex-end;
  max-width: 86%;
  border-radius: 16px 16px 4px 16px;
  padding: 8px 12px;
  background: var(--q-blue-alpha);
  white-space: pre-wrap;
  word-break: break-word;
}

.lares-log__item[data-pending="true"] .lares-msg {
  opacity: 0.72;
}

.lares-md {
  align-self: stretch;
  min-width: 0;
  max-width: 100%;
  overflow-x: hidden;
  font-size: 17px;
  line-height: 1.55;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.lares-md[data-pending="true"] {
  white-space: pre-wrap;
  opacity: 0.92;
}

.lares-md :deep(p),
.lares-md :deep(pre) {
  margin: 0 0 10px;
}

.lares-md :deep(ul),
.lares-md :deep(ol) {
  margin: 4px 0 12px;
  padding: 0 0 0 1.35em;
}

.lares-md :deep(ul) {
  list-style: disc outside;
}

.lares-md :deep(ol) {
  list-style: decimal outside;
}

.lares-md :deep(li + li) {
  margin-top: 6px;
}

.lares-md :deep(p:last-child),
.lares-md :deep(ul:last-child),
.lares-md :deep(ol:last-child),
.lares-md :deep(pre:last-child) {
  margin-bottom: 0;
}

.lares-md :deep(h1),
.lares-md :deep(h2),
.lares-md :deep(h3) {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
}

.lares-md :deep(code) {
  border-radius: 4px;
  padding: 1px 4px;
  background: var(--q-background-3);
  font-size: 15px;
}

.lares-md :deep(pre) {
  box-sizing: border-box;
  max-width: 100%;
  overflow-x: auto;
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--q-background-3);
}

.lares-md :deep(pre code) {
  padding: 0;
  background: transparent;
}

.lares-md :deep(img) {
  max-width: 100%;
  height: auto;
}

.lares-md :deep(a) {
  color: var(--q-blue-default);
}
</style>
