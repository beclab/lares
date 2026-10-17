<template>
  <div class="lares-shell" :data-device="chatDevice">
    <LaresDesktopShell
      v-if="chatDevice === 'desktop'"
      ref="shell"
      :state="shellState"
      :t="t"
      :media-url="mediaUrl"
      :scroll-top="scrollTop"
      :remember-scroll="rememberScroll"
      :sticking="sticking"
      :preview-href="previewHref"
      :model-key="modelKey"
      :effort-name="effortName"
      @create="newChat"
      @pick-session="pickSession"
      @pick-workspace="pickWorkspace"
      @retry="retry"
      @open-file="openFile"
      @answer="answerQuestion"
      @update-draft="updateDraft"
      @send="send"
      @stop="stop"
      @steer-queue="steerQueue"
      @choose-model="chooseModel"
      @choose-effort="chooseEffort"
      @choose-permission="choosePermission"
      @disable-plan="disablePlan"
      @goal-action="goalAction"
      @answer-approval="answerApproval"
      @answer-questions="answerQuestions"
      @open-commands="loadCommands"
      @open-references="loadReferences"
      @pick-command="pickCommand"
      @queue-action="updateQueue"
      @files="attachFiles"
      @remove-image="removeDraftImage"
      @show-chat="showChat"
      @close-preview-tab="closePreviewTab"
      @refresh-workspaces="refreshWorkspaces"
      @browse-workspaces="openWorkspaceBrowser"
      @browse-directory="browseDirectory"
      @close-directory="closeWorkspaceBrowser"
      @choose-directory="chooseWorkspaceDirectory"
      @create-folder="createDirectoryFolder"
      @toggle-hidden="toggleDirectoryHidden"
      @rename-workspace="renameWorkspace"
      @delete-workspace="deleteWorkspace"
      @move-workspace="moveWorkspace"
      @move-session="moveSession"
      @rename-session="renameSession"
      @fork-session="forkSession"
      @archive-session="archiveSession"
    />
    <LaresMobileShell
      v-else
      ref="shell"
      :state="shellState"
      :t="t"
      :media-url="mediaUrl"
      :scroll-top="scrollTop"
      :remember-scroll="rememberScroll"
      :sticking="sticking"
      :preview-href="previewHref"
      :model-key="modelKey"
      :effort-name="effortName"
      @history="toggleHistory"
      @create="newChat"
      @close-history="panel = ''"
      @pick-session="pickSession"
      @refresh-workspaces="refreshWorkspaces"
      @browse-workspaces="openWorkspaceBrowser"
      @browse-directory="browseDirectory"
      @close-directory="closeWorkspaceBrowser"
      @choose-directory="chooseWorkspaceDirectory"
      @create-folder="createDirectoryFolder"
      @toggle-hidden="toggleDirectoryHidden"
      @move-session="moveSession"
      @rename-session="renameSession"
      @archive-session="archiveSession"
      @retry="retry"
      @open-file="openFile"
      @answer="answerQuestion"
      @update-draft="updateDraft"
      @send="send"
      @queue-action="updateQueue"
      @open-model="openModelSheet"
      @open-effort="openEffortSheet"
      @files="attachFiles"
      @hold-start="onHoldStart"
      @voice-action="onVoiceAction"
      @close-model="modelSheet = false"
      @choose-model="chooseModel"
      @close-effort="effortSheet = false"
      @choose-effort="chooseEffort"
      @close-preview="closePreview"
      @remove-image="removeDraftImage"
      @open-commands="loadCommands"
      @open-references="loadReferences"
      @pick-command="pickCommand"
      @toggle-speak="toggleSpeak"
    />
    <LaresVoicePanel v-if="voicePanelState" :view="voicePanelState" :t="t"
      @close="runVoicePanel('close')" @edit="voicePanel.edit($event)" @preset="voicePanel.selectPreset($event, true).catch(() => {})"
      @complete="runVoicePanel('complete')" @discard="runVoicePanel('discard')" />
  </div>
</template>

<script>
import { subscribeVoiceSettings } from "@olares/lares-core/larepass/settings";
import { createVoicePanel } from "@olares/lares-core/voice/panel";
import { mergeVoiceTranscript, subscribeVoiceHistory } from "@olares/lares-core/voice/projection";
import LaresVoicePanel from "./chat/VoicePanel.vue";
import { pickHostPorts } from "@olares/lares-core/larepass/host";
import { connectChat } from "./runtime.js";
import { createT } from "./i18n.js";
import { failText, withPendingUser } from "./chat/format.js";
import { captureSource } from "@olares/lares-core/voice/input";
import { createVoiceConversation } from "@olares/lares-core/voice/conversation";
import { createAnswerPlayer } from "./chat/playback.js";
import { createReplySpeaker, createSentencePlayer, speakable } from "@olares/lares-core/voice/speech";
import { wavBlob } from "@olares/lares-core/voice/client";
import { browserPlays } from "@olares/lares-core/voice/playback";
import { speakProblemText, speakToggleNotice } from "@olares/lares-core/voice/problem";
import { appendDraftMentions } from "@olares/lares-core/files/mention";
import { FileIntake, partitionDocumentsBySize, splitComposerFiles } from "@olares/lares-core/files/intake";
import {
  createDraftImageEntry,
  draftHasSendableContent,
  draftImageStatus,
  draftImagesUploading,
} from "@olares/lares-core/files/draft-images";
import { DEFAULT_MAX_UPLOAD_BYTES } from "@olares/lares-core/files/limits";
import {
  groupModelsByProvider,
  effortMenuRows,
  reasoningOfModel,
  currentEffortId,
  selectionKey,
  sessionModelSelection,
  composerModelsFromCatalog,
  modelSwitchSelection,
  effortSwitchSelection,
} from "@olares/lares-core/router/session-model";
import { messageFromCode } from "@olares/lares-core/i18n/t";
import { parseAskUserQuestions, singleSelectAnswer } from "@olares/lares-core/larepass/questions";
import { applyCommand } from "@olares/lares-core/larepass/commands";
import { permissionOption, presetDescription, presetLabel } from "@olares/lares-core/larepass/permissions";
import { DEFAULT_BUSY_ENTER, resolveSubmitMode } from "@olares/lares-core/larepass/submission-settings";
import { subscribeConversationSettings } from "@olares/lares-core/larepass/settings";
import { markSeen, pruneSeen, readSeen, SEEN_STORAGE_KEY, unseenSessions } from "@olares/lares-core/larepass/unread";
import { fileName } from "@olares/lares-core/files/filename";
import { closeTab, openTab, touchTab } from "@olares/lares-core/files/preview-tabs";
import { isFilesPath } from "@olares/lares-core/drive/files-path";
import { filesAppUrl } from "@olares/lares-core/files/app-link";
import { chatDevice as resolveChatDevice } from "./layout.js";
import LaresMobileShell from "./mobile/MobileShell.vue";
import LaresDesktopShell from "./desktop/DesktopShell.vue";
import "./styles.css";

function imageData(file) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return {
      type: "image",
      mediaType: file.type,
      data: btoa(binary),
      ...(file.name ? { name: file.name } : {}),
    };
  });
}

export default {
  name: "LaresApp",
  components: { LaresMobileShell, LaresDesktopShell, LaresVoicePanel },
  props: {
    locale: { type: String, default: "en" },
    device: { type: String, default: "mobile" },
    baseUrl: { type: String, default: undefined },
    proxyPrefix: { type: String, default: undefined },
    request: { type: Function, default: undefined },
    env: { type: Object, default: undefined },
    // Vue drops an undeclared prop into attrs, so a port missing from this list
    // never reaches `ports` below no matter what the host passes.
    socketProtocol: { type: [Function, String, Array], default: undefined },
    // Set only by laresPortsFromAccount when myApps has no Lares app.
    missing: { type: Boolean, default: false },
  },
  data() {
    return {
      sending: false,
      stopping: false,
      starting: false,
      hostGen: 0,
      modelCatalogGen: 0,
      running: false,
      runningSince: 0,
      sessionId: "",
      draft: "",
      draftBySession: {},
      imagesBySession: {},
      failed: "",
      error: "",
      items: [],
      pendingUser: "",
      unsub: null,
      previews: {},
      previewTabs: [],
      previewLru: [],
      previewPath: "",
      previewMode: "chat",
      previewContents: {},
      panel: "",
      sessions: [],
      sessionsReady: false,
      historyLoading: false,
      modelCatalog: null,
      modelError: "",
      modelPending: "",
      modelSheet: false,
      effortSheet: false,
      upload: { pending: 0, failures: [] },
      draftImages: [],
      voiceCall: null,
      voicePanelState: null,
      voiceRecords: [],
      voicePhase: "idle",
      voiceElapsed: 0,
      voiceError: "",
      voiceLanguage: "",
      voiceSpeak: false,
      voiceDefaultMode: "continuous",
      voiceStreaming: false,
      speakBusy: false,
      speakNotice: "",
      intakeUnsub: null,
      question: null,
      questionBusy: false,
      approval: null,
      approvalBusy: false,
      workspaces: [],
      workspacesReady: false,
      workspaceError: "",
      archivedSessionIds: [],
      seen: { since: 0, sessions: {} },
      permissions: null,
      plan: null,
      contextPressure: null,
      contextBreakdown: null,
      goal: null,
      goalBusy: false,
      todos: null,
      permissionBusy: false,
      commands: null,
      commandsSessionId: "",
      commandsError: "",
      references: [],
      referencesLoading: false,
      referencesError: "",
      referenceGen: 0,
      queue: [],
      queueBusy: "",
      busyEnter: DEFAULT_BUSY_ENTER,
      conversationUnsub: null,
      directory: {
        open: false,
        loading: false,
        listing: null,
        error: "",
        creating: false,
        creatingFolder: false,
        showHidden: false,
        selectPath: "",
      },
    };
  },
  computed: {
    ports() {
      // Built from the canonical key list rather than spelled out, so adding a
      // port does not need this object edited in lockstep.
      return pickHostPorts(this);
    },
    runtime() {
      return connectChat(this.ports);
    },
    hostKey() {
      return this.runtime.key;
    },
    t() {
      return createT(this.locale);
    },
    chatDevice() {
      return resolveChatDevice(this.device);
    },
    currentWorkspaceId() {
      return this.workspaces.find((workspace) => (
        workspace.sessionIds?.includes(this.sessionId)
      ))?.workspaceId || "";
    },
    shellState() {
      return {
        sending: this.sending,
        stopping: this.stopping,
        starting: this.starting,
        running: this.running,
        runningSince: this.runningSince,
        sessionId: this.sessionId,
        sessionTitle: this.sessionTitle,
        draft: this.draft,
        failed: this.failed,
        failText: this.failText,
        viewItems: this.viewItems,
        historyLoading: this.historyLoading,
        previews: this.previews,
        preview: this.preview,
        previewTabs: this.previewTabs,
        previewMode: this.previewMode,
        previewMediaSrc: this.previewMediaSrc,
        previewDownloadHref: this.previewDownloadHref,
        previewFilesHref: this.previewFilesHref,
        panel: this.panel,
        sessions: this.sessions,
        sessionsReady: this.sessionsReady,
        models: this.models,
        modelError: this.modelError,
        modelGroups: this.modelGroups,
        modelCurrent: this.modelCurrent,
        modelLabel: this.modelLabel,
        modelBusy: this.modelBusy,
        modelBlocked: this.modelBlocked,
        modelSheet: this.modelSheet,
        effortSheet: this.effortSheet,
        effortRows: this.effortRows,
        effortId: this.effortId,
        effortLabel: this.effortLabel,
        effortDisabled: this.effortDisabled,
        upload: this.upload,
        draftImages: this.draftImages,
        voiceDefaultMode: this.voiceDefaultMode,
        voiceCall: this.voiceCall,
        voicePanelState: this.voicePanelState,
        voicePhase: this.voicePhase,
        voiceElapsed: this.voiceElapsed,
        voiceErrorText: this.voiceErrorText,
        question: this.question,
        questionBusy: this.questionBusy,
        approval: this.approval,
        approvalBusy: this.approvalBusy,
        canSend: this.canSend,
        workspaces: this.workspaces,
        workspacesReady: this.workspacesReady,
        workspaceError: this.workspaceError,
        archivedSessionIds: this.archivedSessionIds,
        currentWorkspaceId: this.currentWorkspaceId,
        unseen: this.unseen,
        permissionRows: this.permissionRows,
        permissionCurrent: this.permissionCurrent,
        permissionLabel: this.permissionLabel,
        permissionHint: this.permissionHint,
        permissionBusy: this.permissionBusy,
        plan: this.plan,
        planActive: this.planActive,
        contextPressure: this.contextPressure,
        contextBreakdown: this.contextBreakdown,
        goal: this.goal,
        goalBusy: this.goalBusy,
        todos: this.todos,
        commands: this.commands,
        commandsError: this.commandsError,
        references: this.references,
        referencesLoading: this.referencesLoading,
        referencesError: this.referencesError,
        queue: this.queue,
        queueBusy: this.queueBusy,
        busyEnter: this.busyEnter,
        directory: this.directory,
        voiceSpeak: this.voiceSpeak,
        speakBusy: this.speakBusy,
        speakNotice: this.speakNotice,
      };
    },
    unseen() {
      return unseenSessions(this.sessions, this.seen, this.sessionId);
    },
    permissionRows() {
      return (this.permissions?.options ?? [])
        .filter((option) => option.value !== "custom")
        .map((option) => ({
          value: option.value,
          label: presetLabel(this.t, option),
          hint: presetDescription(this.t, option),
        }));
    },
    planActive() {
      return Boolean(this.plan && (this.plan.pending ? !this.plan.active : this.plan.active));
    },
    permissionCurrent() {
      return this.permissions?.currentValue || "";
    },
    permissionLabel() {
      return presetLabel(this.t, permissionOption(this.permissions));
    },
    permissionHint() {
      return presetDescription(this.t, permissionOption(this.permissions));
    },
    canSend() {
      return draftHasSendableContent(this.draft, this.draftImages)
        && Boolean(this.sessionId)
        && !this.modelBlocked
        && !this.historyLoading
        && this.upload.pending === 0
        && !draftImagesUploading(this.draftImages);
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
    liveModelSelection() {
      const row = this.sessions.find((item) => item.sessionId === this.sessionId);
      return row?.modelSelection ?? null;
    },
    models() {
      return composerModelsFromCatalog(
        this.modelCatalog,
        sessionModelSelection(this.liveModelSelection, this.modelCatalog?.default),
      );
    },
    reasoning() {
      return reasoningOfModel(this.currentListedModel);
    },
    effortId() {
      return currentEffortId(this.models?.default, this.reasoning);
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
      return mergeVoiceTranscript(withPendingUser(this.items, this.pendingUser), this.voiceRecords);
    },
    failText() {
      return failText(this.t, this.failed, this.error);
    },
    preview() {
      if (!this.previewPath) return { path: "", status: "idle", data: null, error: "" };
      const content = this.previewContents[this.previewPath];
      return { path: this.previewPath, ...(content ?? { status: "loading", data: null, error: "" }) };
    },
    previewMediaSrc() {
      const data = this.preview.data;
      if (!data) return "";
      return this.runtime.mediaUrl(
        data.path,
        data.modifiedAt,
        data.kind === "image" ? "big" : undefined,
      );
    },
    previewDownloadHref() {
      if (!this.preview.path) return "";
      return this.runtime.downloadUrl(this.preview.path);
    },
    previewFilesHref() {
      if (!this.preview.path) return "";
      return filesAppUrl(this.preview.path, {
        entrance: this.baseUrl,
        accountDomain: this.env?.ACCOUNT_DOMAIN,
        protocol: this.env?.PROTOCOL,
      });
    },
    previewHref() {
      return (path) => {
        const href = this.runtime.mediaUrl(path, undefined, "big");
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
      return Boolean(this.modelPending) || (this.modelSheet && !this.modelCatalog);
    },
    modelBlocked() {
      return this.chatDevice === "desktop" && this.models?.routable === false;
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
      this.bindVoiceHistory(id);
      void this.voicePanel?.bind(id || null).catch(() => {});
      this.bindIntake(id);
    },
    hostKey() {
      this.switchHost();
    },
  },
  created() {
    // Per-path request tokens: reactive state would re-render on every read.
    this.previewGen = new Map();
    this.previewOpenGen = 0;
    this.intake = new FileIntake((file, sessionId, options) => this.runtime.upload(file, options, sessionId));
    this.imageUploadControllers = new Map();
    this.player = createAnswerPlayer();
    this.voicePanel = createVoicePanel({
      create: (options) => this.createMobileVoiceConversation(options),
      loadConfig: async () => (await this.runtime.settings.voice(true)).config,
      process: async ({ text, preset, config, signal }) => { const response = await this.runtime.voiceRequest("/api/lares/voice/dictation/clean", { method: "POST", body: { text, preset, config: { dictationProfiles: config.dictationProfiles } }, signal }); if (!response.ok) throw new Error(response.body?.error?.code || "voice_cleanup_failed"); return response.body.text; },
      complete: async ({ sessionId, text }) => {
        const previous = sessionId === (this.sessionId || null) ? this.draft : this.draftBySession[sessionId || "@pending"] || "";
        const value = [previous, text].filter(Boolean).join(" ");
        this.draftBySession = { ...this.draftBySession, [sessionId || "@pending"]: value };
        if (sessionId === (this.sessionId || null)) this.draft = value;
      },
      onSession: (sessionId) => {
        this.voiceAdoptingSession = sessionId;
        void Promise.resolve(this.runtime.openSession(sessionId)).catch((error) => { this.voiceError = error.message; this.voiceAdoptingSession = null; });
      },
    });
    this.voiceSettingsUnsub = subscribeVoiceSettings((value) => { this.voiceDefaultMode = value.config.mobileMode; });
    this.voicePanelState = this.voicePanel.getSnapshot();
    this.voicePanelUnsub = this.voicePanel.subscribe(() => {
      const view = this.voicePanel.getSnapshot(); this.voicePanelState = view;
      this.voiceCall = view.snapshot?.connection === "closed" ? null : view.snapshot;
      this.voicePhase = view.snapshot?.capture || "idle"; this.voiceError = view.error || view.snapshot?.error || "";
    });
    this.replySpeaker = createReplySpeaker();
    this.reader = createSentencePlayer({
      send: async (request) => {
        const result = await this.runtime.speak?.(request);
        if (!result) throw Object.assign(new Error("voice_speak_failed"), { code: "voice_speak_failed" });
        return result;
      },
      play: (sentence) => {
        if (!browserPlays("mobile", sentence.bluetooth)) return Promise.resolve(false);
        return this.player?.play(wavBlob(sentence.audio));
      },
      halt: () => this.player?.stop(),
      silence: () => void this.runtime.interruptSpeech?.(),
      fail: (err) => this.showSpeakProblem(err),
    });

    this.bindIntake(this.sessionId);
    this.bindRuntime();
    try {
      this.seen = readSeen(JSON.parse(localStorage.getItem(SEEN_STORAGE_KEY) || "null"));
    } catch {
      this.seen = readSeen(null);
    }
    // `since` is the floor for sessions this device has never opened, so pin it
    // on the first launch instead of letting every launch move it forward.
    this.persistSeen();
  },
  mounted() {
    this.conversationUnsub = subscribeConversationSettings((section) => {
      this.busyEnter = section.busyEnter;
    });
    this.voiceVisibilityHandler = () => {
      if (document.hidden) void this.voicePanel.pause().catch(() => {});
    };
    document.addEventListener("visibilitychange", this.voiceVisibilityHandler);
    this.voiceClock = setInterval(() => {
      if (this.voicePhase === "recording") this.voiceElapsed += 1;
    }, 1000);
    this.retry();
  },
  activated() {
    this.restoreLog();
  },
  deactivated() {
    void this.voicePanel?.pause().catch(() => {});
    this.captureLog();
  },
  beforeUnmount() {
    document.removeEventListener("visibilitychange", this.voiceVisibilityHandler);
    clearInterval(this.voiceClock);
    this.captureLog();
    this.noteSeen(this.sessionId);
    for (const controller of this.imageUploadControllers?.values?.() ?? []) controller.abort();
    this.imageUploadControllers?.clear?.();
    void this.voicePanel?.dispose().catch(() => {});
    this.voicePanelUnsub?.();
    this.voiceSettingsUnsub?.();
    this.voiceHistoryUnsub?.();
    this.conversationUnsub?.();
    this.intakeUnsub?.();
    if (this.sessionId) this.intake?.cancelSession(this.sessionId);
    this.releaseDraftImages();
    this.unsub?.();
    this.unsub = null;
  },
  methods: {
    mediaUrl(item) {
      return this.runtime.mediaUrl(
        item.path,
        item.modifiedAt,
        item.kind === "image" ? "big" : undefined,
      );
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
      this.$refs.shell?.restoreLog?.();
    },
    captureLog() {
      this.$refs.shell?.captureLog?.();
    },
    pinLog() {
      this.$refs.shell?.pinLog?.();
    },
    applySnap(snap) {
      const sessionChanged = snap.sessionId !== this.sessionId;
      if (sessionChanged) {
        const previousKey = this.sessionId || "@pending";
        const nextKey = snap.sessionId || "@pending";
        this.draftBySession = { ...this.draftBySession, [previousKey]: this.draft };
        this.imagesBySession = { ...this.imagesBySession, [previousKey]: this.draftImages };
        if (previousKey === "@pending" && snap.sessionId && !(nextKey in this.draftBySession)) {
          this.draftBySession = { ...this.draftBySession, [nextKey]: this.draft };
          this.imagesBySession = { ...this.imagesBySession, [nextKey]: this.draftImages };
        }
        this.draft = this.draftBySession[nextKey] ?? "";
        this.draftImages = this.imagesBySession[nextKey] ?? [];
        // Leaving a session marks everything in it as watched, and arriving
        // clears the dot on the one now on screen.
        this.noteSeen(this.sessionId);
        this.noteSeen(snap.sessionId);
        this.pendingUser = "";
        this.previews = {};
        this.resetPreview();
        this.commands = null;
        this.commandsError = "";
      }
      if (sessionChanged && snap.sessionId !== this.voiceAdoptingSession) {
        void this.voicePanel?.pause().catch(() => {});
        this.reader.stop();
        this.player?.stop();
      }
      if (sessionChanged) this.voiceAdoptingSession = null;
      const utterance = this.replySpeaker.observe({
        sessionChanged,
        wasRunning: this.running,
        running: snap.running,
        utterance: snap.utterance,
      });
      this.sessionId = snap.sessionId;
      this.items = snap.items;
      this.running = snap.running;
      this.runningSince = snap.runningSince || 0;
      const target = this.voiceSpeak && !this.voiceCall ? speakable(utterance, this.voiceStreaming) : null;
      if (target) this.reader.follow({ ...target, key: `${snap.sessionId}:${target.key}` });
      this.failed = snap.failed;
      this.error = snap.error;
      this.sessions = snap.sessions ?? this.sessions;
      this.sessionsReady = Boolean(snap.sessionsReady);
      this.workspaces = snap.workspaces ?? this.workspaces;
      this.workspacesReady = Boolean(snap.workspacesReady);
      this.workspaceError = snap.workspaceError || "";
      this.archivedSessionIds = snap.archivedSessionIds ?? this.archivedSessionIds;
      this.historyLoading = Boolean(snap.historyLoading);
      this.permissions = snap.permissions ?? null;
      this.plan = snap.plan ?? null;
      this.contextPressure = snap.contextPressure ?? null;
      this.contextBreakdown = snap.contextBreakdown ?? null;
      this.goal = snap.goal ?? null;
      this.todos = snap.todos ?? null;
      this.queue = snap.queue ?? [];
      this.question = snap.question || null;
      if (!this.question) this.questionBusy = false;
      this.approval = snap.approval || null;
      if (!this.approval) this.approvalBusy = false;
      if (this.pendingUser && snap.items.some((row) => row.type === "user" && row.text === this.pendingUser)) {
        this.pendingUser = "";
      }
      this.pinLog();
    },
    noteSeen(sessionId) {
      if (!sessionId) return;
      const next = markSeen(this.seen, sessionId);
      if (next === this.seen) return;
      this.seen = next;
      this.persistSeen();
    },
    updateDraft(value) {
      this.draft = String(value ?? "");
      const key = this.sessionId || "@pending";
      this.draftBySession = { ...this.draftBySession, [key]: this.draft };
    },
    persistSeen() {
      if (this.sessionsReady && this.sessions.length) {
        this.seen = pruneSeen(this.seen, this.sessions);
      }
      try {
        localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(this.seen));
      } catch {
        // storage may be blocked
      }
    },
    async choosePermission(value) {
      if (!value || value === this.permissionCurrent || this.permissionBusy) return;
      this.permissionBusy = true;
      try {
        const switched = await this.runtime.setPermission(value);
        if (!switched.ok) {
          this.failed = switched.error?.message || switched.error?.code || "permission";
        }
      } finally {
        this.permissionBusy = false;
      }
    },
    async disablePlan() {
      if (!this.planActive) return;
      const result = await this.runtime.runCommand("/plan off");
      if (!result.ok) this.failed = result.error?.message || result.error?.code || "plan";
    },
    async goalAction(kind, value) {
      if (this.goalBusy) return;
      this.goalBusy = true;
      try {
        const result = await this.runtime.goalAction(kind, value);
        if (!result.ok) this.failed = result.error?.message || result.error?.code || "goal";
      } finally {
        this.goalBusy = false;
      }
    },
    async loadCommands() {
      if (this.commands && this.commandsSessionId === this.sessionId) return;
      this.commandsError = "";
      try {
        this.commands = await this.runtime.listCommands();
        this.commandsSessionId = this.sessionId;
      } catch (err) {
        this.commands = [];
        this.commandsError = err instanceof Error ? err.message : String(err);
      }
    },
    async loadReferences({ query = "", quoted = false } = {}) {
      const gen = ++this.referenceGen;
      this.referencesLoading = true;
      this.referencesError = "";
      try {
        const rows = await this.runtime.listReferences(query, quoted);
        if (gen !== this.referenceGen) return;
        this.references = rows;
      } catch (err) {
        if (gen !== this.referenceGen) return;
        this.references = [];
        this.referencesError = err instanceof Error ? err.message : String(err);
      } finally {
        if (gen === this.referenceGen) this.referencesLoading = false;
      }
    },
    pickCommand(command) {
      if (!command?.name) return;
      this.updateDraft(applyCommand(this.draft, command));
      this.$refs.shell?.focusComposer?.();
    },
    async hydrateFiles(paths) {
      const missing = [...new Set(paths)].filter((path) => !Object.hasOwn(this.previews, path));
      if (!missing.length) return;
      const sessionId = this.sessionId;
      const loaded = Object.create(null);
      await Promise.all(missing.map(async (path) => {
        try {
          loaded[path] = await this.runtime.preview(path);
        } catch {
          loaded[path] = null;
        }
      }));
      if (this.sessionId !== sessionId) return;
      this.previews = { ...this.previews, ...loaded };
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
    async answerQuestions(answer) {
      if (!answer?.answers?.length || this.questionBusy) return;
      this.questionBusy = true;
      try {
        const result = await this.runtime.answerQuestion(answer.answers);
        if (!result?.ok) this.questionBusy = false;
      } catch {
        this.questionBusy = false;
      }
    },
    async answerApproval(outcome) {
      if (!this.approval || this.approvalBusy) return;
      this.approvalBusy = true;
      try {
        const result = await this.runtime.answerApproval(outcome);
        if (!result?.ok) this.approvalBusy = false;
      } catch {
        this.approvalBusy = false;
      }
    },
    openPreviewTab(path) {
      const { tabs, lru, evicted } = openTab({ tabs: this.previewTabs, lru: this.previewLru }, path);
      this.previewTabs = tabs;
      this.previewLru = lru;
      if (evicted) this.dropPreviewContent(evicted.path);
      this.previewPath = path;
      this.previewMode = "preview";
    },
    async openFile(path) {
      const openGen = ++this.previewOpenGen;
      if (isFilesPath(path)) {
        const gen = (this.previewGen.get(path) ?? 0) + 1;
        this.previewGen.set(path, gen);
        try {
          const data = await this.runtime.preview(path);
          if (this.previewGen.get(path) !== gen || this.previewOpenGen !== openGen) return;
          this.openPreviewTab(path);
          const canonical = this.adoptPreviewPath(path, data?.path);
          this.previewGen.set(canonical, gen);
          this.setPreviewContent(canonical, gen, { status: "ready", data, error: "" });
        } catch {
          // Keep the Produced card in place so another click retries with the
          // browser's then-current credential.
        }
        return;
      }
      this.openPreviewTab(path);
      return this.loadPreview(path);
    },
    showChat() {
      this.previewMode = "chat";
    },
    closePreviewTab(path) {
      const closed = closeTab(
        { tabs: this.previewTabs, lru: this.previewLru, activePath: this.previewPath },
        path,
      );
      if (!closed) return;
      this.previewTabs = closed.tabs;
      this.previewLru = closed.lru;
      this.previewPath = closed.activePath ?? "";
      if (!closed.activePath) this.previewMode = "chat";
      this.dropPreviewContent(path);
    },
    closePreview() {
      if (this.previewPath) this.closePreviewTab(this.previewPath);
    },
    resetPreview() {
      this.previewOpenGen += 1;
      this.previewTabs = [];
      this.previewLru = [];
      this.previewPath = "";
      this.previewMode = "chat";
      this.previewContents = {};
      this.previewGen.clear();
    },
    dropPreviewContent(path) {
      const rest = { ...this.previewContents };
      delete rest[path];
      this.previewContents = rest;
      this.previewGen.delete(path);
    },
    /**
     * The Host answers with its own spelling of the path, so a file opened from
     * a produced-file chip and the same file reached through a markdown link
     * end up on one tab instead of two.
     */
    adoptPreviewPath(requested, answered) {
      const canonical = answered || requested;
      if (canonical === requested) return requested;
      this.previewTabs = this.previewTabs.some((tab) => tab.path === canonical)
        ? this.previewTabs.filter((tab) => tab.path !== requested)
        : this.previewTabs.map((tab) => (
          tab.path === requested ? { path: canonical, name: fileName(canonical) } : tab
        ));
      this.previewLru = touchTab(this.previewLru.filter((item) => item !== requested), canonical);
      if (this.previewPath === requested) this.previewPath = canonical;
      this.dropPreviewContent(requested);
      return canonical;
    },
    /**
     * Reopening a tab re-reads the file: the agent may have rewritten it since.
     * Cached content stays on screen until the fresh read lands, so switching
     * tabs does not flash a spinner over a file that is already there.
     */
    async loadPreview(path) {
      const gen = (this.previewGen.get(path) ?? 0) + 1;
      this.previewGen.set(path, gen);
      if (this.previewContents[path]?.status !== "ready") {
        this.setPreviewContent(path, gen, { status: "loading", data: null, error: "" });
      }
      try {
        const data = await this.runtime.preview(path);
        if (this.previewGen.get(path) !== gen) return;
        this.previews = { ...this.previews, [path]: data };
        const canonical = this.adoptPreviewPath(path, data?.path);
        this.previewGen.set(canonical, gen);
        this.setPreviewContent(canonical, gen, { status: "ready", data, error: "" });
      } catch (err) {
        if (
          isFilesPath(path)
          && ["files_no_credential", "files_unauthenticated"].includes(err instanceof Error ? err.message : "")
        ) {
          this.closePreviewTab(path);
          return;
        }
        this.setPreviewContent(path, gen, {
          status: "error",
          data: null,
          error: err instanceof Error ? err.message : "file_preview_failed",
        });
      }
    },
    setPreviewContent(path, gen, content) {
      if (this.previewGen.get(path) !== gen) return;
      this.previewContents = { ...this.previewContents, [path]: content };
    },
    async retry() {
      const gen = ++this.hostGen;
      this.starting = true;
      try {
        await this.runtime.start({ workspaces: this.chatDevice === "desktop" });
        if (gen !== this.hostGen) return;
        if (this.chatDevice !== "desktop") await this.runtime.refreshWorkspaces();
        await this.loadComposerMeta();
      } finally {
        if (gen === this.hostGen) this.starting = false;
      }
    },
    modelKey(model) {
      return selectionKey({ provider: model.provider, model: model.id });
    },
    bindRuntime() {
      this.unsub?.();
      this.unsub = this.runtime.subscribe((snap) => this.applySnap(snap));
    },
    switchHost() {
      void this.voicePanel?.end().catch(() => {});
      for (const controller of this.imageUploadControllers.values()) controller.abort();
      this.imageUploadControllers.clear();
      this.releaseDraftImages();
      this.intakeUnsub?.();
      if (this.sessionId) this.intake?.cancelSession(this.sessionId);
      this.sessionId = "";
      this.items = [];
      this.sessions = [];
      this.sessionsReady = false;
      this.previews = {};
      this.resetPreview();
      this.pendingUser = "";
      this.failed = "";
      this.error = "";
      this.modelCatalog = null;
      this.modelError = "";
      this.modelPending = "";
      this.modelSheet = false;
      this.panel = "";
      this.question = null;
      this.questionBusy = false;
      this.approval = null;
      this.approvalBusy = false;
      this.workspaces = [];
      this.workspacesReady = false;
      this.workspaceError = "";
      this.archivedSessionIds = [];
      this.permissions = null;
      this.permissionBusy = false;
      this.goal = null;
      this.goalBusy = false;
      this.todos = null;
      this.commands = null;
      this.commandsSessionId = "";
      this.commandsError = "";
      this.references = [];
      this.referencesLoading = false;
      this.referencesError = "";
      this.referenceGen += 1;
      this.queue = [];
      this.queueBusy = "";
      this.busyEnter = DEFAULT_BUSY_ENTER;
      this.directory = {
        open: false,
        loading: false,
        listing: null,
        error: "",
        creating: false,
      };
      this.bindIntake("");
      this.bindRuntime();
      this.retry();
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
      const jobs = [this.loadModelCatalog()];
      if (settings && this.chatDevice === "desktop") {
        jobs.push(settings.conversation().then((section) => {
          this.busyEnter = section.busyEnter;
        }).catch(() => {
          this.busyEnter = DEFAULT_BUSY_ENTER;
        }));
      }
      if (settings) {
        jobs.push(settings.voice().then((voice) => {
          this.voiceLanguage = voice.config?.language || "";
          this.voiceDefaultMode = voice.config?.mobileMode || "continuous";
          this.voiceSpeak = voice.config?.speak === true;
          this.voiceStreaming = voice.config?.streaming === true;
        }).catch(() => {
          this.voiceLanguage = "";
          this.voiceSpeak = false;
          this.voiceStreaming = false;
        }));
      }
      await Promise.all(jobs);
    },
    async loadModelCatalog() {
      const gen = ++this.modelCatalogGen;
      const loaded = await this.runtime.modelCatalog();
      if (gen !== this.modelCatalogGen) return;
      if (!loaded.ok) {
        this.modelCatalog = null;
        this.modelError = loaded.error?.message || loaded.error?.code || "models";
        return;
      }
      this.modelCatalog = loaded.value ?? null;
      this.modelError = "";
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
    async chooseEffort(id) {
      const current = this.models?.default;
      if (!current || id === this.effortId || this.modelBusy) return;
      if (this.chatDevice === "desktop") this.effortSheet = false;
      this.modelPending = `${this.modelCurrent}\u0000${id ?? ""}`;
      this.modelError = "";
      try {
        const selected = await this.runtime.selectModel(effortSwitchSelection(current, id));
        if (!selected.ok) {
          this.modelError = selected.error?.message || selected.error?.code || "model";
        }
      } finally {
        this.modelPending = "";
      }
    },
    openModelSheet() {
      this.modelSheet = true;
      if (!this.modelCatalog) void this.loadModelCatalog();
    },
    async chooseModel(model) {
      const key = this.modelKey(model);
      if (key === this.modelCurrent || this.modelBusy) return;
      if (this.chatDevice === "desktop") this.modelSheet = false;
      this.modelPending = key;
      this.modelError = "";
      try {
        const selected = await this.runtime.selectModel(modelSwitchSelection({ id: model.provider }, model));
        if (!selected.ok) throw new Error(selected.error?.message || selected.error?.code || "model");
      } catch (err) {
        this.modelError = err instanceof Error ? err.message : String(err);
      } finally {
        this.modelPending = "";
      }
    },
    patchDraftImage(sessionId, imageId, patch) {
      const rows = sessionId === this.sessionId
        ? this.draftImages
        : (this.imagesBySession[sessionId] ?? []);
      const index = rows.findIndex((row) => row.id === imageId);
      if (index < 0) return;
      const previous = rows[index];
      if (patch.previewUrl && previous.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previous.previewUrl);
      }
      const next = [...rows];
      next[index] = { ...previous, ...patch };
      this.imagesBySession = { ...this.imagesBySession, [sessionId]: next };
      if (sessionId === this.sessionId) this.draftImages = next;
    },
    async uploadDraftImage(sessionId, imageId) {
      const rows = sessionId === this.sessionId
        ? this.draftImages
        : (this.imagesBySession[sessionId] ?? []);
      const image = rows.find((row) => row.id === imageId);
      if (!image?.file || draftImageStatus(image) !== "uploading") return;
      const controller = new AbortController();
      this.imageUploadControllers.set(imageId, controller);
      try {
        const result = await this.runtime.upload(
          image.file,
          { signal: controller.signal, requestId: imageId },
          sessionId,
        );
        if (controller.signal.aborted) return;
        this.patchDraftImage(sessionId, imageId, {
          status: "ready",
          path: result.path,
          previewUrl: this.runtime.mediaUrl(result.path),
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        this.patchDraftImage(sessionId, imageId, {
          status: "failed",
          error: err instanceof Error ? err.message : "file_upload_failed",
        });
      } finally {
        this.imageUploadControllers.delete(imageId);
      }
    },
    attachFiles(files) {
      const sessionId = this.sessionId;
      if (!sessionId || !files?.length) return;
      const { images, documents } = splitComposerFiles(files);
      const added = images.map((file) => createDraftImageEntry(file));
      if (added.length) {
        this.draftImages = [...this.draftImages, ...added];
        this.imagesBySession = { ...this.imagesBySession, [sessionId]: this.draftImages };
        for (const image of added) void this.uploadDraftImage(sessionId, image.id);
      }
      const { accepted, oversized } = partitionDocumentsBySize(documents, DEFAULT_MAX_UPLOAD_BYTES);
      for (const file of oversized) this.intake.reportFailure(sessionId, file, "file_too_large");
      void this.intake.uploadFiles(sessionId, accepted, (paths) => {
        const previous = sessionId === this.sessionId
          ? this.draft
          : this.draftBySession[sessionId] ?? "";
        const next = appendDraftMentions(previous, paths);
        this.draftBySession = { ...this.draftBySession, [sessionId]: next };
        if (sessionId === this.sessionId) this.draft = next;
      });
    },
    removeDraftImage(id) {
      this.imageUploadControllers.get(id)?.abort();
      this.imageUploadControllers.delete(id);
      const image = this.draftImages.find((row) => row.id === id);
      if (image?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(image.previewUrl);
      this.draftImages = this.draftImages.filter((row) => row.id !== id);
      this.imagesBySession = { ...this.imagesBySession, [this.sessionId || "@pending"]: this.draftImages };
    },
    releaseDraftImages() {
      const seen = new Set();
      for (const rows of Object.values(this.imagesBySession)) {
        for (const image of rows) {
          if (seen.has(image.id)) continue;
          seen.add(image.id);
          if (image.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(image.previewUrl);
        }
      }
      for (const image of this.draftImages) {
        if (!seen.has(image.id) && image.previewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(image.previewUrl);
        }
      }
      this.draftImages = [];
      this.imagesBySession = {};
    },
    async onHoldStart() {
      const settings = await this.runtime.settings.voice(true);
      this.voiceDefaultMode = settings.config.mobileMode;
      await this.voicePanel.open({ mode: this.voicePanelState?.mode === "single" && this.voicePanelState.raw ? "single" : this.voiceDefaultMode, sessionId: this.sessionId || null });
    },
    onVoiceAction({ action, value }) {
      if (action === "stopPlayback") { void this.voicePanel.conversation?.controller.stopPlayback().catch(() => {}); return; }
      if (action === "setCancelArmed") { this.voicePanel.setCancelArmed(value); return; }
      if (["holdStart", "holdEnd", "finish", "start", "close"].includes(action)) void Promise.resolve(this.voicePanel[action](value)).catch(() => {});
    },
    runVoicePanel(action) { void this.voicePanel[action]().catch(() => {}); },
    async createMobileVoiceConversation({ mode, onTranscript, onDevice, config }) {
      const settings = { config };
      const continuous = mode === "continuous";
      onDevice(captureSource("mobile", settings.config.device));
      if (settings.config.backend === "realtime" && continuous) throw new Error("voice_manual_realtime_unavailable");
      this.reader.stop(); this.player?.stop(); this.player?.unlock();
      let conversation;
      const reader = createSentencePlayer({
        send: (value) => conversation.speak(value),
        play: (sentence) => sentence.bluetooth === "played" ? Promise.resolve() : this.player.play(wavBlob(sentence.audio)),
        halt: () => this.player.stop(), silence: () => {},
        onState: (playing) => conversation?.playbackState(playing),
        fail: (error) => { this.showSpeakProblem(error); void conversation.controller.disconnect("voice_playback_failed"); },
      });
      conversation = createVoiceConversation({
        captureConfig: { model: config.model, language: config.language },
        request: (path, options) => this.runtime.voiceRequest(path, options),
        transcribe: (blob, signal) => this.runtime.transcribe(blob, config.language, signal, config.model),
        device: captureSource("mobile", settings.config.device),
        readAloud: continuous && settings.config.speak,
        preset: continuous && settings.config.preset === "dictation" ? "assistant" : settings.config.preset, endpointSilenceMs: settings.config.endpointSilenceMs, idleTimeoutMs: settings.config.idleTimeoutMs, recoveryTimeoutMs: settings.config.recoveryTimeoutMs,
        presentationSession: true,
        onTranscript: continuous ? null : onTranscript,
        mode: () => resolveSubmitMode(this.running, false, true, this.busyEnter),
        playback: { stop: () => { reader.stop(); this.player.stop(); } },
        onReply: (reply) => { const value = speakable(reply, settings.config.streaming); if (value) reader.follow(value); },
      });
      return conversation;
    },
    bindVoiceHistory(sessionId) {
      this.voiceHistoryUnsub?.(); this.voiceRecords = [];
      if (!sessionId) return;
      this.voiceHistoryUnsub = subscribeVoiceHistory({ sessionId, request: (path, options) => this.runtime.voiceRequest(path, options),
        onRecords: (rows) => { if (this.sessionId === sessionId) this.voiceRecords = rows; },
        onError: (error) => { this.voiceError = error.message; },
      });
    },
    showSpeakProblem(err) {
      this.speakNotice = speakProblemText(this.t, err);
    },
    async toggleSpeak() {
      if (this.speakBusy) return;
      this.speakNotice = "";
      if (typeof this.runtime.settings?.saveVoice !== "function") {
        this.speakNotice = this.t("error.voice_speak_unready");
        return;
      }
      const next = !this.voiceSpeak;
      const previous = this.voiceSpeak;
      this.voiceSpeak = next;
      this.speakBusy = true;
      if (!next) {
        this.reader.stop();
        this.player?.stop();
        void this.runtime.interruptSpeech?.();
      }
      try {
        const voice = await this.runtime.settings.saveVoice({ speak: next });
        this.voiceSpeak = voice?.config ? voice.config.speak === true : next;
        this.voiceStreaming = voice?.config?.streaming === true;
        const problem = this.voiceSpeak ? speakToggleNotice(voice?.ttsModels) : "";
        this.speakNotice = problem ? this.t(`error.${problem}`) : "";
      } catch (err) {
        this.voiceSpeak = previous;
        this.showSpeakProblem(err);
      } finally {
        this.speakBusy = false;
      }
    },
    toggleHistory() {
      if (this.panel === "history") {
        this.panel = "";
        return;
      }
      this.panel = "history";
      // Refresh after the sheet slide so list work does not block the first paint.
      window.setTimeout(() => {
        if (this.panel !== "history") return;
        void Promise.all([this.runtime.refreshSessions(), this.runtime.refreshWorkspaces()]);
      }, 320);
    },
    pickSession(sessionId) {
      this.panel = "";
      if (!sessionId || sessionId === this.sessionId) return;
      this.pendingUser = "";
      this.previews = {};
      this.runtime.openSession(sessionId);
    },
    newChat(workspaceId = null) {
      this.panel = "";
      this.pendingUser = "";
      this.previews = {};
      this.draftBySession = { ...this.draftBySession, "@pending": "" };
      this.imagesBySession = { ...this.imagesBySession, "@pending": [] };
      const scoped = workspaceId || (this.chatDevice === "desktop" ? "" : this.currentWorkspaceId) || null;
      this.runtime.createSession(scoped);
    },
    pickWorkspace(workspaceId) {
      if (!workspaceId || workspaceId === this.currentWorkspaceId) return;
      this.newChat(workspaceId);
    },
    refreshWorkspaces() {
      return this.runtime.refreshWorkspaces();
    },
    async openWorkspaceBrowser() {
      this.directory = {
        open: true,
        loading: true,
        listing: null,
        error: "",
        creating: false,
        creatingFolder: false,
        showHidden: false,
        selectPath: "",
      };
      await this.browseDirectory();
    },
    closeWorkspaceBrowser() {
      if (this.directory.creating || this.directory.creatingFolder) return;
      this.directory = { ...this.directory, open: false, error: "", selectPath: "" };
    },
    toggleDirectoryHidden(showHidden) {
      this.directory = { ...this.directory, showHidden: Boolean(showHidden) };
    },
    async createDirectoryFolder(name) {
      const parent = this.directory.listing?.path;
      if (!parent || !name?.trim() || this.directory.creatingFolder) return;
      this.directory = { ...this.directory, creatingFolder: true, error: "" };
      const created = await this.runtime.createDirectory(parent, name.trim());
      if (!this.directory.open) return;
      if (!created.ok) {
        this.directory = {
          ...this.directory,
          creatingFolder: false,
          error: created.error?.message || created.error?.code || "directory",
        };
        return;
      }
      const selectPath = created.value?.path || "";
      await this.browseDirectory(parent);
      if (!this.directory.open) return;
      this.directory = {
        ...this.directory,
        creatingFolder: false,
        selectPath,
        error: "",
      };
    },
    async browseDirectory(path) {
      this.directory = { ...this.directory, loading: true, error: "" };
      const listed = await this.runtime.listDirectory(path);
      if (!this.directory.open) return;
      if (!listed.ok) {
        this.directory = {
          ...this.directory,
          loading: false,
          error: listed.error?.message || listed.error?.code || "directory",
        };
        return;
      }
      this.directory = {
        ...this.directory,
        loading: false,
        listing: listed.value,
        error: "",
      };
    },
    async chooseWorkspaceDirectory(path) {
      if (!path || this.directory.creating) return;
      this.directory = { ...this.directory, creating: true, error: "" };
      const created = await this.runtime.createWorkspace(path);
      if (!created.ok) {
        this.directory = {
          ...this.directory,
          creating: false,
          error: created.error?.message || created.error?.code || "workspace",
        };
        return;
      }
      const workspaceId = created.value?.workspace?.workspaceId;
      this.directory = { ...this.directory, open: false, creating: false };
      if (workspaceId) this.newChat(workspaceId);
    },
    async renameWorkspace(workspaceId, title) {
      if (!workspaceId || !title?.trim()) return;
      await this.runtime.renameWorkspace(workspaceId, title.trim());
    },
    async deleteWorkspace(workspaceId) {
      if (!workspaceId) return;
      await this.runtime.deleteWorkspace(workspaceId);
    },
    moveWorkspace(workspaceId, beforeWorkspaceId) {
      if (!workspaceId) return;
      return this.runtime.insertWorkspaceBefore(workspaceId, beforeWorkspaceId);
    },
    moveSession(workspaceId, sessionId, beforeSessionId) {
      if (!workspaceId || !sessionId) return;
      return this.runtime.insertSessionBefore(workspaceId, sessionId, beforeSessionId);
    },
    renameSession(sessionId, title) {
      if (!sessionId || !title?.trim()) return;
      return this.runtime.renameSession(sessionId, title.trim());
    },
    forkSession(sessionId) {
      if (!sessionId) return;
      this.pendingUser = "";
      this.previews = {};
      return this.runtime.forkSession(sessionId);
    },
    archiveSession(sessionId) {
      if (!sessionId) return;
      return this.runtime.archiveSession(sessionId);
    },
    async send(mode = "queue") {
      const text = this.draft.trim();
      if (!this.canSend) return;
      this.player?.unlock();
      const sessionId = this.sessionId;
      const images = this.draftImages.filter((row) => draftImageStatus(row) === "ready");
      const wasRunning = this.running;
      this.sending = true;
      this.draft = "";
      this.draftImages = [];
      this.draftBySession = { ...this.draftBySession, [sessionId]: "" };
      this.imagesBySession = { ...this.imagesBySession, [sessionId]: [] };
      this.pendingUser = wasRunning ? "" : text;
      this.runtime.pinToBottom();
      this.pinLog();
      try {
        const content = [
          ...(text ? [{ type: "text", text }] : []),
          ...(await Promise.all(images.map((row) => imageData(row.file)))),
        ];
        const sent = await this.runtime.send(content, mode === "steer" ? "steer" : "queue");
        if (!sent.ok) {
          this.pendingUser = "";
          this.draftBySession = { ...this.draftBySession, [sessionId]: text };
          this.imagesBySession = { ...this.imagesBySession, [sessionId]: images };
          if (this.sessionId === sessionId) {
            this.draft = text;
            this.draftImages = images;
          }
          this.failed = sent.error?.message || sent.error?.code || "send";
        } else {
          for (const image of images) URL.revokeObjectURL(image.previewUrl);
        }
      } catch (err) {
        this.pendingUser = "";
        this.draftBySession = { ...this.draftBySession, [sessionId]: text };
        this.imagesBySession = { ...this.imagesBySession, [sessionId]: images };
        if (this.sessionId === sessionId) {
          this.draft = text;
          this.draftImages = images;
        }
        this.failed = err instanceof Error ? err.message : "attachment";
      } finally {
        this.sending = false;
      }
    },
    async updateQueue(itemId, action) {
      if (!itemId || this.queueBusy) return;
      this.queueBusy = itemId;
      try {
        const changed = await this.runtime.updateQueue(itemId, action);
        if (!changed.ok) {
          this.failed = changed.error?.message || changed.error?.code || "queue";
        }
      } finally {
        this.queueBusy = "";
      }
    },
    async steerQueue() {
      const rows = this.queue.filter((row) => row.placement === "queued");
      for (const row of rows) {
        await this.updateQueue(row.id, { kind: "steer" });
      }
    },
    async stop() {
      if (!this.running || this.stopping) return;
      this.stopping = true;
      try {
        const stopped = await this.runtime.cancel();
        if (!stopped.ok) {
          this.failed = stopped.error?.message || stopped.error?.code || "cancel";
        }
      } finally {
        this.stopping = false;
      }
    },
  },
};
</script>
