<template>
  <div class="desktop-shell">
    <LaresDesktopSidebar
      :state="state"
      :t="t"
      @create="$emit('create', $event)"
      @pick-session="$emit('pick-session', $event)"
      @browse-workspaces="$emit('browse-workspaces')"
      @refresh-workspaces="$emit('refresh-workspaces')"
      @rename-workspace="onRenameWorkspace"
      @delete-workspace="$emit('delete-workspace', $event)"
      @move-workspace="onMoveWorkspace"
      @move-session="onMoveSession"
      @rename-session="onRenameSession"
      @fork-session="$emit('fork-session', $event)"
      @archive-session="$emit('archive-session', $event)"
    />
    <main class="desktop-shell__main">
      <header v-if="!newSessionHero" class="desktop-shell__header">
        <h1>{{ state.sessionTitle }}</h1>
        <Transition name="lares-tabs">
          <LaresDesktopPreviewTabs
            v-if="state.previewTabs.length"
            :tabs="state.previewTabs"
            :active="state.previewMode === 'preview' ? state.preview.path : ''"
            :t="t"
            @chat="$emit('show-chat')"
            @activate="$emit('open-file', $event)"
            @close="$emit('close-preview-tab', $event)"
          />
        </Transition>
      </header>
      <section class="desktop-shell__conversation" :data-hero="newSessionHero ? 'true' : 'false'">
        <div v-if="state.failed" class="desktop-shell__failure">
          <span>{{ state.failText }}</span>
          <button type="button" :disabled="state.starting" @click="$emit('retry')">{{ t("probe.retry") }}</button>
        </div>
        <div v-if="newSessionHero" class="desktop-shell__brand">
          <div class="desktop-shell__logo" :style="logoStyle" aria-hidden="true" />
          <h1>{{ t("shell.title") }}</h1>
        </div>
        <LaresTranscript
          v-if="!newSessionHero"
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
          question-takeover
          :t="t"
          @open="$emit('open-file', $event)"
          @media="pinLog"
          @answer="forwardAnswer"
        />
        <LaresDesktopComposer
          ref="composer"
          :state="state"
          :t="t"
          :hero="newSessionHero"
          :model-key="modelKey"
          :effort-name="effortName"
          @update-draft="$emit('update-draft', $event)"
          @send="$emit('send', $event)"
          @stop="$emit('stop')"
          @steer-queue="$emit('steer-queue')"
          @files="$emit('files', $event)"
          @remove-image="$emit('remove-image', $event)"
          @choose-model="$emit('choose-model', $event)"
          @pick-workspace="$emit('pick-workspace', $event)"
          @choose-effort="$emit('choose-effort', $event)"
          @choose-permission="$emit('choose-permission', $event)"
          @disable-plan="$emit('disable-plan')"
          @goal-action="(kind, value) => $emit('goal-action', kind, value)"
          @answer-approval="$emit('answer-approval', $event)"
          @answer-questions="$emit('answer-questions', $event)"
          @open-commands="$emit('open-commands')"
          @open-references="$emit('open-references', $event)"
          @pick-command="$emit('pick-command', $event)"
          @queue-action="onQueueAction"
        />
        <Transition name="lares-desk-preview">
          <LaresDesktopPreview
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
            @retry="$emit('open-file', state.preview.path)"
            @open="$emit('open-file', $event)"
          />
        </Transition>
      </section>
    </main>
    <LaresDirectoryBrowser
      :state="state.directory"
      :t="t"
      @close="$emit('close-directory')"
      @browse="$emit('browse-directory', $event)"
      @choose="$emit('choose-directory', $event)"
      @create-folder="$emit('create-folder', $event)"
      @toggle-hidden="$emit('toggle-hidden', $event)"
    />
  </div>
</template>

<script>
import LaresTranscript from "../chat/Transcript.vue";
import LaresDesktopPreview from "./DesktopPreview.vue";
import LaresDesktopPreviewTabs from "./DesktopPreviewTabs.vue";
import LaresDesktopSidebar from "./DesktopSidebar.vue";
import LaresDesktopComposer from "./DesktopComposer.vue";
import LaresDirectoryBrowser from "./DirectoryBrowser.vue";
import { MARK_DATA_URI } from "@olares/lares-core/icons/mark";

export default {
  name: "LaresDesktopShell",
  components: {
    LaresTranscript,
    LaresDesktopPreview,
    LaresDesktopPreviewTabs,
    LaresDesktopSidebar,
    LaresDesktopComposer,
    LaresDirectoryBrowser,
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
    "create", "pick-session", "pick-workspace", "retry", "open-file", "answer", "update-draft",
    "send", "stop", "steer-queue", "files", "remove-image", "choose-model", "choose-effort", "choose-permission", "disable-plan", "goal-action", "answer-approval", "answer-questions",
    "open-commands", "open-references", "pick-command", "queue-action", "show-chat", "close-preview-tab",
    "refresh-workspaces", "browse-workspaces", "browse-directory",
    "close-directory", "choose-directory", "create-folder", "toggle-hidden", "rename-workspace",
    "delete-workspace", "move-workspace", "move-session", "rename-session",
    "fork-session", "archive-session",
  ],
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
    logoStyle() {
      return { backgroundImage: MARK_DATA_URI };
    },
  },
  methods: {
    focusComposer() {
      this.$refs.composer?.focus?.();
    },
    onRenameWorkspace(workspaceId, title) {
      this.$emit("rename-workspace", workspaceId, title);
    },
    onMoveWorkspace(workspaceId, beforeWorkspaceId) {
      this.$emit("move-workspace", workspaceId, beforeWorkspaceId);
    },
    onMoveSession(workspaceId, sessionId, beforeSessionId) {
      this.$emit("move-session", workspaceId, sessionId, beforeSessionId);
    },
    onRenameSession(sessionId, title) {
      this.$emit("rename-session", sessionId, title);
    },
    onQueueAction(itemId, action) {
      this.$emit("queue-action", itemId, action);
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
  },
};
</script>

<style scoped>
/* One reading column for the transcript rows and the composer, so their edges line up. */
.desktop-shell { --lares-column:min(760px, 100%); --lares-gutter:24px; position:relative; display:flex; width:100%; min-width:0; min-height:0; flex:1; overflow:hidden; background:var(--q-background-1); color:var(--q-ink-1); }
.desktop-shell__main { display:flex; min-width:0; min-height:0; flex:1; flex-direction:column; }
.desktop-shell__header { display:flex; height:44px; flex-shrink:0; align-items:center; gap:16px; padding:0 18px; border-bottom:1px solid var(--q-separator); }
.desktop-shell__header h1 { max-width:min(280px, 40%); overflow:hidden; margin:0; font-size:15px; font-weight:500; line-height:22px; text-overflow:ellipsis; white-space:nowrap; }
.desktop-shell__conversation { position:relative; display:flex; min-width:0; min-height:0; flex:1; flex-direction:column; }
.desktop-shell__conversation[data-hero="true"] { justify-content:center; }
.desktop-shell__brand { display:flex; align-items:center; justify-content:center; gap:12px; margin-bottom:36px; }
.desktop-shell__brand h1 { margin:0; color:var(--q-ink-1); font-size:26px; font-weight:600; line-height:34px; letter-spacing:-.01em; }
.desktop-shell__logo { width:44px; height:44px; background-position:center; background-repeat:no-repeat; background-size:cover; box-shadow:inset 0 1.5px 0 rgb(255 255 255 / 50%); }
.desktop-shell__failure { display:flex; width:calc(var(--lares-column) - 2 * var(--lares-gutter)); align-items:center; gap:10px; margin:12px auto 0; color:var(--q-orange-default); font-size:14px; }
.desktop-shell__failure button { border:0; border-radius:6px; padding:5px 8px; background:var(--q-blue-alpha); color:var(--q-blue-default); }
/* The scroller stays full width so the wheel works over the gutters; the rows carry the reading column. */
.desktop-shell :deep(.lares-log) { align-items:center; padding:16px 0 8px; gap:12px; }
.desktop-shell :deep(.lares-log > *) { box-sizing:border-box; width:var(--lares-column); padding-inline:var(--lares-gutter); }
.desktop-shell :deep(.lares-log__item[data-type="user"]) { margin-top:18px; }
.desktop-shell :deep(.lares-log__item[data-type="assistant"]) { margin-top:12px; }
.desktop-shell :deep(.lares-msg[data-role="user"]) { max-width:68%; border-radius:16px; padding:10px 14px; }
.desktop-shell :deep(.lares-md) { font-size:15px; line-height:1.65; }
@media (max-width:760px) {
  .desktop-shell { --lares-gutter:18px; }
}
</style>
