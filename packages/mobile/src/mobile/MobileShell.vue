<template>
  <div class="lares-mobile-shell">
    <LaresChatBar
      :t="t"
      :title="barTitle"
      :starting="state.starting"
      @history="$emit('history')"
      @create="$emit('create', state.currentWorkspaceId || null)"
    />
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
          :workspace-label="workspaceLabel"
          :workspace-busy="!state.workspacesReady && !state.workspaceError"
          :model-label="state.modelLabel"
          :model-busy="state.modelBusy"
          @workspace="workspaceSheet = true"
          @model="$emit('open-model')"
        >
          <LaresComposer
            ref="composer"
            hero
            :draft="state.draft"
            :sending="state.sending"
            :can-send="state.canSend"
            :model-label="state.modelLabel"
            :model-busy="state.modelBusy"
            :effort-label="state.effortLabel"
            :effort-disabled="state.effortDisabled"
            :attach-pending="state.upload.pending > 0"
            :attach-disabled="!state.sessionId || state.historyLoading || state.starting"
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
            :t="t"
            @update:draft="$emit('update-draft', $event)"
            @send="$emit('send')"
            @model="$emit('open-model')"
            @effort="$emit('open-effort')"
            @files="$emit('files', $event)"
            @voice="$emit('voice')"
            @hold-start="$emit('hold-start')"
            @hold-end="$emit('hold-end')"
            @open-commands="$emit('open-commands')"
            @open-references="$emit('open-references', $event)"
            @pick-command="$emit('pick-command', $event)"
            @remove-image="$emit('remove-image', $event)"
          />
        </LaresMobileNewSession>

        <div v-else key="chat" class="lares-shell__chat">
          <LaresTranscript
            ref="transcript"
            :items="state.viewItems"
            :running="state.running"
            :loading="state.historyLoading || state.starting"
            :previews="state.previews"
            :media-url="mediaUrl"
            :scroll-top="scrollTop"
            :remember-scroll="rememberScroll"
            :sticking="sticking"
            :session-id="state.sessionId"
            :question="state.question"
            :question-busy="state.questionBusy"
            :t="t"
            @open="$emit('open-file', $event)"
            @media="pinLog"
            @answer="forwardAnswer"
          />
          <LaresComposer
            ref="composer"
            :draft="state.draft"
            :sending="state.sending"
            :can-send="state.canSend"
            :model-label="state.modelLabel"
            :model-busy="state.modelBusy"
            :effort-label="state.effortLabel"
            :effort-disabled="state.effortDisabled"
            :attach-pending="state.upload.pending > 0"
            :attach-disabled="!state.sessionId || state.historyLoading || state.starting"
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
            :t="t"
            @update:draft="$emit('update-draft', $event)"
            @send="$emit('send')"
            @model="$emit('open-model')"
            @effort="$emit('open-effort')"
            @files="$emit('files', $event)"
            @voice="$emit('voice')"
            @hold-start="$emit('hold-start')"
            @hold-end="$emit('hold-end')"
            @open-commands="$emit('open-commands')"
            @open-references="$emit('open-references', $event)"
            @pick-command="$emit('pick-command', $event)"
            @remove-image="$emit('remove-image', $event)"
          />
        </div>
      </Transition>
    </div>

    <LaresSheet :open="workspaceSheet" :title="t('desktop.workspaces')" @close="workspaceSheet = false">
      <p v-if="state.workspaceError" class="lares-shell__status">{{ state.workspaceError }}</p>
      <p v-else-if="!state.workspacesReady" class="lares-shell__hint">{{ t("agent.loading") }}</p>
      <p v-else-if="!state.workspaces.length" class="lares-shell__hint">{{ t("desktop.noFolders") }}</p>
      <LaresSettingRow
        v-for="workspace in state.workspaces"
        :key="workspace.workspaceId"
        :label="workspace.title"
        :checked="workspace.workspaceId === state.currentWorkspaceId"
        @click="pickWorkspace(workspace.workspaceId)"
      />
    </LaresSheet>
    <LaresSheet :open="state.modelSheet" :title="t('model.menuAria')" @close="$emit('close-model')">
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
    </LaresSheet>
    <LaresSheet :open="state.effortSheet" :title="t('reasoning.title')" @close="$emit('close-effort')">
      <p v-if="!state.effortRows.length" class="lares-shell__hint">{{ t("reasoning.default") }}</p>
      <LaresSettingRow
        v-for="row in state.effortRows"
        :key="row.key"
        :label="effortName(row)"
        :checked="row.id === state.effortId"
        :disabled="state.modelBusy"
        @click="$emit('choose-effort', row.id)"
      />
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
import LaresComposer from "../chat/Composer.vue";
import LaresPreview from "../preview/Preview.vue";
import LaresSheet from "../settings/Sheet.vue";
import LaresSettingRow from "../settings/SettingRow.vue";
import LaresMobileDirectorySheet from "./MobileDirectorySheet.vue";
import LaresMobileNewSession from "./MobileNewSession.vue";
import { DEFAULT_WORKSPACE_TITLE } from "@olares/lares-core/workspace/constants";

export default {
  name: "LaresMobileShell",
  components: {
    LaresChatBar,
    LaresHistoryPanel,
    LaresTranscript,
    LaresComposer,
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
    "history", "create", "close-history", "pick-session", "retry", "open-file",
    "answer", "update-draft", "send", "open-model", "open-effort", "files",
    "voice", "hold-start", "hold-end", "close-model", "choose-model",
    "close-effort", "choose-effort", "close-preview",
    "open-commands", "open-references", "pick-command", "remove-image",
    "refresh-workspaces", "browse-workspaces", "browse-directory",
    "close-directory", "choose-directory", "create-folder", "toggle-hidden",
    "rename-session", "archive-session",
    "move-session", "pick-workspace",
  ],
  data() {
    return { workspaceSheet: false };
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
    barTitle() {
      return this.newSessionHero ? this.t("desktop.newSession") : this.state.sessionTitle;
    },
    workspaceLabel() {
      if (!this.state.workspacesReady) return this.t("agent.loading");
      const current = this.state.workspaces.find(
        (row) => row.workspaceId === this.state.currentWorkspaceId,
      );
      if (current?.title) return current.title;
      if (this.state.workspaces[0]?.title) return this.state.workspaces[0].title;
      return DEFAULT_WORKSPACE_TITLE;
    },
  },
  methods: {
    pickWorkspace(workspaceId) {
      this.workspaceSheet = false;
      if (!workspaceId || workspaceId === this.state.currentWorkspaceId) return;
      this.$emit("pick-workspace", workspaceId);
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
  justify-content: center;
}

.lares-shell__chat {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
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
  font-size: 14px;
  font-weight: 500;
  line-height: 18px;
}
</style>
