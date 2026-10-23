<template>
  <div class="lares-mobile-shell">
    <LaresChatBar
      :t="t"
      :starting="state.starting"
      :model-label="state.modelLabel"
      :model-busy="state.modelBusy"
      :effort-label="state.effortLabel"
      :effort-disabled="state.effortDisabled"
      :unseen="hasUnseen"
      :speak="state.voiceSpeak"
      :speak-busy="state.speakBusy"
      @history="$emit('history')"
      @model="$emit('open-model')"
      @effort="$emit('open-model')"
      @speak="$emit('toggle-speak')"
    />
    <p v-if="state.speakNotice" class="lares-speak-notice" role="status">
      <span>{{ state.speakNotice }}</span>
      <button type="button" @click="$emit('dismiss-speak')">{{ t('readout.dismiss') }}</button>
    </p>
    <LaresHistoryPanel
      :open="state.panel === 'history'"
      :sessions="state.sessions"
      :workspaces="state.workspaces"
      :workspaces-ready="state.workspacesReady"
      :workspace-error="state.workspaceError"
      :archived-session-ids="state.archivedSessionIds"
      :session-id="state.sessionId"
      :ready="state.sessionsReady"
      :unseen="state.unseen"
      :t="t"
      @close="$emit('close-history')"
      @pick="$emit('pick-session', $event)"
      @create="$emit('create', $event)"
      @browse-workspaces="$emit('browse-workspaces')"
      @refresh-workspaces="$emit('refresh-workspaces')"
      @rename-session="(id, title) => $emit('rename-session', id, title)"
      @archive-session="$emit('archive-session', $event)"
      @move-session="(workspaceId, sessionId, before) => $emit('move-session', workspaceId, sessionId, before)"
    />
    <LaresMobileDirectorySheet
      :open="state.directory.open"
      :state="state.directory"
      :t="t"
      @close="$emit('close-directory')"
      @browse="$emit('browse-directory', $event)"
      @choose="$emit('choose-directory', $event)"
      @create-folder="$emit('create-folder', $event)"
      @toggle-hidden="$emit('toggle-hidden', $event)"
    />
    <div class="lares-shell__conversation" :data-hero="newSessionHero ? 'true' : 'false'">
      <p v-if="state.failed" class="lares-shell__status">{{ state.failText }}</p>
      <p v-else-if="state.actionNotice" class="lares-shell__status" role="status">{{ state.actionNotice }}</p>
      <button
        v-if="state.failed"
        type="button"
        class="lares-shell__retry"
        :disabled="state.starting"
        @click="$emit('retry')"
      >
        {{ t("probe.retry") }}
      </button>

      <Transition name="lares-view" mode="out-in">
        <LaresMobileNewSession
          v-if="newSessionHero"
          key="hero"
          :t="t"
        >
          <LaresComposer
            ref="composer"
            hero
            :draft="state.draft"
            :sending="state.sending"
            :can-send="state.canSend"
            :attach-pending="state.upload.pending > 0"
            :attach-disabled="!state.sessionId || state.historyLoading || state.starting"
            :voice-view="state.voicePanelState"
            :voice-call="state.voiceCall"
            :voice-default-mode="state.voiceDefaultMode"
            :voice-phase="state.voicePhase"
            :voice-elapsed="state.voiceElapsed"
            :voice-error="state.voiceErrorText"
            :failures="state.upload.failures"
            :draft-images="state.draftImages"
            :references="state.references"
            :references-loading="state.referencesLoading"
            :references-error="state.referencesError"
            :commands="state.commands"
            :commands-error="state.commandsError"
            :input-mode="composerMode"
            :t="t"
            @update:draft="$emit('update-draft', $event)"
            @update:input-mode="composerMode = $event"
            @send="$emit('send')"
            @files="$emit('files', $event)"
            @voice="$emit('voice')"
            @hold-start="$emit('hold-start', $event)"
            @hold-end="$emit('hold-end', $event)"
            @voice-action="$emit('voice-action', $event)"
            @open-commands="$emit('open-commands')"
            @open-references="$emit('open-references', $event)"
            @pick-command="$emit('pick-command', $event)"
            @remove-image="$emit('remove-image', $event)"
          />
        </LaresMobileNewSession>

        <div v-else key="chat" class="lares-shell__chat">
          <LaresTranscript
            ref="transcript"
            :voice-view="state.voicePanelState"
            @stop-speaking="$emit('voice-action', { action: 'stopPlayback' })"
            :items="state.viewItems"
            :running="state.running"
            :running-since="state.runningSince"
            :loading="state.historyLoading || state.starting"
            :previews="state.previews"
            :media-url="mediaUrl"
            :scroll-top="scrollTop"
            :remember-scroll="rememberScroll"
            :sticking="sticking"
            :session-id="state.sessionId"
            popup
            :question="state.question"
            :question-busy="state.questionBusy"
            :t="t"
            @open="$emit('open-file', $event)"
            @media="pinLog"
            @answer="forwardAnswer"
          />
          <LaresDesktopQueue
            tone="mobile"
            :items="state.queue"
            :running="state.running"
            :busy="state.queueBusy"
            :t="t"
            @action="(itemId, action) => $emit('queue-action', itemId, action)"
          />
          <div v-if="state.approval" class="lares-mobile-shell__approval">
            <LaresApprovalCard
              :approval="state.approval"
              :busy="state.approvalBusy"
              :t="t"
              @answer="$emit('answer-approval', $event)"
            />
          </div>
          <LaresComposer
            v-else
            ref="composer"
            :draft="state.draft"
            :sending="state.sending"
            :can-send="state.canSend"
            :attach-pending="state.upload.pending > 0"
            :attach-disabled="!state.sessionId || state.historyLoading || state.starting"
            :voice-view="state.voicePanelState"
            :voice-call="state.voiceCall"
            :voice-default-mode="state.voiceDefaultMode"
            :voice-phase="state.voicePhase"
            :voice-elapsed="state.voiceElapsed"
            :voice-error="state.voiceErrorText"
            :failures="state.upload.failures"
            :draft-images="state.draftImages"
            :references="state.references"
            :references-loading="state.referencesLoading"
            :references-error="state.referencesError"
            :commands="state.commands"
            :commands-error="state.commandsError"
            :input-mode="composerMode"
            :t="t"
            @update:draft="$emit('update-draft', $event)"
            @update:input-mode="composerMode = $event"
            @send="$emit('send')"
            @files="$emit('files', $event)"
            @voice="$emit('voice')"
            @hold-start="$emit('hold-start', $event)"
            @hold-end="$emit('hold-end', $event)"
            @voice-action="$emit('voice-action', $event)"
            @open-commands="$emit('open-commands')"
            @open-references="$emit('open-references', $event)"
            @pick-command="$emit('pick-command', $event)"
            @remove-image="$emit('remove-image', $event)"
          />
        </div>
      </Transition>
    </div>

    <LaresSheet :open="state.modelSheet" :title="t('model.menuAria')" @close="$emit('close-model')">
      <p v-if="state.modelCatalogError" class="lares-shell__status" role="status">{{ state.modelCatalogError }}</p>
      <p v-if="state.modelError" class="lares-shell__status">{{ state.modelError }}</p>
      <p v-else-if="!state.models" class="lares-shell__hint">{{ t("agent.loading") }}</p>
      <p v-else-if="!state.modelGroups.length" class="lares-shell__hint">{{ t("model.empty") }}</p>
      <template v-for="section in state.modelGroups" :key="section.provider">
        <p class="lares-shell__heading">{{ section.provider }}</p>
        <LaresSettingRow
          v-for="item in section.models"
          :key="modelKey(item)"
          :label="item.name"
          :checked="modelKey(item) === state.modelCurrent"
          :disabled="state.modelBusy"
          @click="$emit('choose-model', item)"
        />
      </template>
      <template v-if="state.effortRows.length">
        <p class="lares-shell__heading">{{ t("reasoning.title") }}</p>
        <LaresSettingRow
          v-for="row in state.effortRows"
          :key="row.key"
          :label="effortName(row)"
          :checked="row.id === state.effortId"
          :disabled="state.modelBusy"
          @click="$emit('choose-effort', row.id)"
        />
      </template>
      <template v-if="state.permissionRows.length">
        <p class="lares-shell__heading">{{ t("permission.title") }}</p>
        <LaresSettingRow
          v-for="row in state.permissionRows"
          :key="row.value"
          :label="row.label"
          :hint="row.hint"
          :checked="row.value === state.permissionCurrent"
          :disabled="state.permissionBusy"
          @click="pickPermission(row.value)"
        />
        <div v-if="accessConfirm" class="lares-shell__access">
          <p>{{ t("access.confirm.description") }}</p>
          <label>
            <input v-model="accessAcknowledged" type="checkbox" />
            <span>{{ t("access.confirm.acknowledge") }}</span>
          </label>
          <div class="lares-shell__access-actions">
            <button type="button" @click="cancelAccess">{{ t("access.confirm.cancel") }}</button>
            <button
              type="button"
              :disabled="!accessAcknowledged || state.permissionBusy"
              @click="confirmAccess"
            >{{ t("access.confirm.enable") }}</button>
          </div>
        </div>
      </template>
      <template #footer>
        <button type="button" class="lares-shell__refresh" @click="state.refreshModels()">{{ t('agent.refresh') }}</button>
      </template>
    </LaresSheet>
    <Transition name="lares-preview">
      <LaresPreview
        v-if="state.previewMode === 'preview' && state.preview.path"
        :path="state.preview.path"
        :session-id="state.sessionId"
        :status="state.preview.status"
        :data="state.preview.data"
        :error="state.preview.error"
        :media-src="state.previewMediaSrc"
        :download-href="state.previewDownloadHref"
        :files-href="state.previewFilesHref"
        :href-for="previewHref"
        :t="t"
        @close="$emit('close-preview')"
        @retry="$emit('open-file', state.preview.path)"
        @open="$emit('open-file', $event)"
      />
    </Transition>
  </div>
</template>

<script>
import LaresChatBar from "../chat/ChatBar.vue";
import LaresHistoryPanel from "../chat/HistoryPanel.vue";
import LaresTranscript from "../chat/Transcript.vue";
import LaresApprovalCard from "../chat/ApprovalCard.vue";
import LaresComposer from "../chat/Composer.vue";
import LaresDesktopQueue from "../desktop/DesktopQueue.vue";
import LaresPreview from "../preview/Preview.vue";
import LaresSheet from "../settings/Sheet.vue";
import LaresSettingRow from "../settings/SettingRow.vue";
import LaresMobileDirectorySheet from "./MobileDirectorySheet.vue";
import LaresMobileNewSession from "./MobileNewSession.vue";

export default {
  name: "LaresMobileShell",
  components: {
    LaresChatBar,
    LaresHistoryPanel,
    LaresTranscript,
    LaresApprovalCard,
    LaresComposer,
    LaresDesktopQueue,
    LaresPreview,
    LaresSheet,
    LaresSettingRow,
    LaresMobileDirectorySheet,
    LaresMobileNewSession,
  },
  props: {
    state: { type: Object, required: true },
    t: { type: Function, required: true },
    mediaUrl: { type: Function, required: true },
    scrollTop: { type: Function, required: true },
    rememberScroll: { type: Function, required: true },
    sticking: { type: Function, required: true },
    previewHref: { type: Function, required: true },
    modelKey: { type: Function, required: true },
    effortName: { type: Function, required: true },
  },
  emits: [
    "history", "create", "toggle-speak", "close-history", "pick-session", "retry", "open-file",
    "answer", "answer-approval", "update-draft", "send", "queue-action", "open-model", "open-effort", "files",
    "voice", "voice-action", "hold-start", "hold-end", "close-model", "choose-model",
    "close-effort", "choose-effort", "choose-permission", "close-preview",
    "open-commands", "open-references", "pick-command", "remove-image",
    "refresh-workspaces", "browse-workspaces", "browse-directory",
    "close-directory", "choose-directory", "create-folder", "toggle-hidden",
    "rename-session", "archive-session",
    "move-session",
    "dismiss-speak",
  ],
  data() {
    return { composerMode: "text", accessConfirm: false, accessAcknowledged: false };
  },
  watch: {
    "state.modelSheet"(open) {
      if (!open) this.cancelAccess();
    },
  },
  computed: {
    newSessionHero() {
      if (this.state.previewMode === "preview" && this.state.preview.path) return false;
      return (
        this.state.viewItems.length === 0
        && !this.state.running
        && !this.state.historyLoading
        && !this.state.starting
      );
    },
    hasUnseen() {
      const unseen = this.state.unseen;
      return Boolean(unseen && Object.keys(unseen).length);
    },
  },
  methods: {
    pickPermission(value) {
      if (!value || value === this.state.permissionCurrent || this.state.permissionBusy) return;
      if (value === "danger-full-access") {
        this.accessAcknowledged = false;
        this.accessConfirm = true;
        return;
      }
      this.cancelAccess();
      this.$emit("choose-permission", value);
    },
    cancelAccess() {
      this.accessConfirm = false;
      this.accessAcknowledged = false;
    },
    confirmAccess() {
      if (!this.accessAcknowledged || this.state.permissionBusy) return;
      this.cancelAccess();
      this.$emit("choose-permission", "danger-full-access");
    },
    forwardAnswer(label, row) {
      this.$emit("answer", label, row);
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
    focusComposer() {
      this.$refs.composer?.focus?.();
    },
  },
};
</script>

<style scoped>
.lares-mobile-shell {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}

.lares-shell__conversation[data-hero="true"] {
  justify-content: flex-start;
}

.lares-shell__chat {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.lares-mobile-shell__approval {
  flex: none;
  margin: 0 16px 12px;
}

.lares-shell__status,
.lares-shell__hint {
  margin: 0 20px;
  font-size: 15px;
  color: var(--q-ink-3);
}

.lares-shell__status {
  color: var(--q-orange-default);
}

.lares-speak-notice {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 16px 8px;
  padding: 8px 12px;
  border-radius: 12px;
  background: var(--q-orange-alpha);
  color: var(--q-orange-default);
  font-size: 14px;
  line-height: 20px;
}

.lares-speak-notice span {
  flex: 1;
  min-width: 0;
}

.lares-speak-notice button {
  flex: none;
  border: 0;
  border-radius: 8px;
  padding: 6px 10px;
  background: transparent;
  color: var(--q-ink-2);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
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

.lares-shell__refresh {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 48px;
  margin: 0;
  border: 0;
  border-radius: 0;
  padding: 0;
  background: var(--q-yellow-default);
  color: var(--q-ink-1);
  font: inherit;
  font-size: 16px;
  font-weight: 500;
  text-align: center;
}

.lares-shell__refresh:active {
  background: var(--q-yellow-pressed);
}

.lares-shell__heading {
  margin: 0;
  padding: 12px 16px 4px;
  color: var(--q-ink-3);
  font-size: 14px;
  font-weight: 500;
  line-height: 18px;
}

.lares-shell__access {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 8px 16px 16px;
  padding: 12px;
  border-radius: 12px;
  background: var(--q-background-3);
  color: var(--q-ink-2);
  font-size: 14px;
  line-height: 20px;
}

.lares-shell__access p {
  margin: 0;
}

.lares-shell__access label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.lares-shell__access input {
  width: 18px;
  height: 18px;
  flex: none;
  margin: 1px 0 0;
}

.lares-shell__access-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.lares-shell__access-actions button {
  border: 0;
  border-radius: 8px;
  padding: 8px 12px;
  background: transparent;
  color: var(--q-ink-2);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
}

.lares-shell__access-actions button:last-child {
  background: var(--q-blue-alpha);
  color: var(--q-blue-default);
}

.lares-shell__access-actions button:disabled {
  opacity: 0.45;
}
</style>
