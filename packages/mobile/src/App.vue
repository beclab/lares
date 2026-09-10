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
      @pick-workspace="pickWorkspace"
      @retry="retry"
      @open-file="openFile"
      @answer="answerQuestion"
      @update-draft="updateDraft"
      @send="send"
      @open-model="openModelSheet"
      @open-effort="openEffortSheet"
      @files="attachFiles"
      @voice="toggleVoice"
      @hold-start="onHoldStart"
      @hold-end="onHoldEnd"
      @close-model="modelSheet = false"
      @choose-model="chooseModel"
      @close-effort="effortSheet = false"
      @choose-effort="chooseEffort"
      @close-preview="closePreview"
      @remove-image="removeDraftImage"
      @open-commands="loadCommands"
      @open-references="loadReferences"
      @pick-command="pickCommand"
    />
  </div>
</template>

<script>
import { pickHostPorts } from "@olares/lares-core/larepass/host";
import { connectChat } from "./runtime.js";
import { createT } from "./i18n.js";
import { failText, withPendingUser } from "./chat/format.js";
import { createVoiceCapture } from "./chat/voice.js";
import { appendDraftMentions } from "@olares/lares-core/files/mention";
import { FileIntake, partitionDocumentsBySize, splitComposerFiles } from "@olares/lares-core/files/intake";
import {
  createDraftImageEntry,
  draftHasSendableContent,
  draftImageStatus,
  draftImagesUploading,
} from "@olares/lares-core/files/draft-images";
import { DEFAULT_MAX_UPLOAD_BYTES } from "@olares/lares-core/files/limits";
import { groupModelsByProvider, effortMenuRows, reasoningOfModel, currentEffortId, selectionKey } from "@olares/lares-core/router/session-model";
import { messageFromCode } from "@olares/lares-core/i18n/t";
import { parseAskUserQuestions, singleSelectAnswer } from "@olares/lares-core/larepass/questions";
import { applyCommand } from "@olares/lares-core/larepass/commands";
import { permissionOption, presetDescription, presetLabel } from "@olares/lares-core/larepass/permissions";
import { DEFAULT_BUSY_ENTER } from "@olares/lares-core/larepass/submission-settings";
import { subscribeConversationSettings } from "@olares/lares-core/larepass/settings";
import { markSeen, pruneSeen, readSeen, SEEN_STORAGE_KEY, unseenSessions } from "@olares/lares-core/larepass/unread";
import { fileName } from "@olares/lares-core/files/filename";
import { closeTab, openTab, touchTab } from "@olares/lares-core/files/preview-tabs";
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
  components: { LaresMobileShell, LaresDesktopShell },
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
  },
  data() {
    return {
      sending: false,
      stopping: false,
      starting: false,
      hostGen: 0,
      modelGen: 0,
      running: false,
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
      models: null,
      modelError: "",
      modelPending: "",
      modelSheet: false,
      effortSheet: false,
      effortByModel: {},
      upload: { pending: 0, failures: [] },
      draftImages: [],
      voicePhase: "idle",
      voiceElapsed: 0,
      voiceError: "",
      voiceLanguage: "",
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
    reasoning() {
      return reasoningOfModel(this.currentListedModel);
    },
    effortId() {
      if (this.chatDevice === "desktop") {
        return currentEffortId(this.models?.default, this.reasoning);
      }
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
    preview() {
      if (!this.previewPath) return { path: "", status: "idle", data: null, error: "" };
      const content = this.previewContents[this.previewPath];
      return { path: this.previewPath, ...(content ?? { status: "loading", data: null, error: "" }) };
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
      this.bindIntake(id);
    },
    hostKey() {
      this.switchHost();
    },
  },
  created() {
    // Per-path request tokens: reactive state would re-render on every read.
    this.previewGen = new Map();
    this.intake = new FileIntake((file, sessionId, options) => this.runtime.upload(file, options, sessionId));
    this.imageUploadControllers = new Map();
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
    this.bindRuntime();
    try {
      const raw = JSON.parse(localStorage.getItem("lares.mobile.effort") || "{}");
      if (raw && typeof raw === "object") this.effortByModel = raw;
    } catch {
      this.effortByModel = {};
    }
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
    this.noteSeen(this.sessionId);
    for (const controller of this.imageUploadControllers?.values?.() ?? []) controller.abort();
    this.imageUploadControllers?.clear?.();
    this.voiceCap?.dispose();
    this.conversationUnsub?.();
    this.intakeUnsub?.();
    if (this.sessionId) this.intake?.cancelSession(this.sessionId);
    this.releaseDraftImages();
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
      this.sessionId = snap.sessionId;
      this.items = snap.items;
      this.running = snap.running;
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
      if (sessionChanged && this.chatDevice === "desktop") {
        void this.loadSessionModels(snap.sessionId);
      }
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
    openFile(path) {
      const { tabs, lru, evicted } = openTab({ tabs: this.previewTabs, lru: this.previewLru }, path);
      this.previewTabs = tabs;
      this.previewLru = lru;
      if (evicted) this.dropPreviewContent(evicted.path);
      this.previewPath = path;
      this.previewMode = "preview";
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
      this.voiceCap?.stop?.(true);
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
      this.models = null;
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
      if (!settings) return;
      if (this.chatDevice === "desktop") {
        await Promise.all([
          this.loadSessionModels(this.sessionId),
          settings.conversation().then((section) => {
            this.busyEnter = section.busyEnter;
          }).catch(() => {
            this.busyEnter = DEFAULT_BUSY_ENTER;
          }),
        ]);
      } else {
        try {
          this.models = await settings.models();
          this.modelError = "";
        } catch (err) {
          this.modelError = err instanceof Error ? err.message : String(err);
        }
      }
      try {
        const voice = await settings.voice();
        this.voiceLanguage = voice.config?.language || "";
      } catch {
        this.voiceLanguage = "";
      }
    },
    async loadSessionModels(sessionId) {
      const gen = ++this.modelGen;
      if (!sessionId) {
        this.models = null;
        return;
      }
      this.modelError = "";
      const loaded = await this.runtime.sessionModels(sessionId);
      if (gen !== this.modelGen || sessionId !== this.sessionId) return;
      if (!loaded.ok) {
        this.models = null;
        this.modelError = loaded.error?.message || loaded.error?.code || "models";
        return;
      }
      const value = loaded.value ?? {};
      this.models = {
        default: value.current,
        routable: value.routable !== false,
        failures: value.failures ?? [],
        models: (value.groups ?? []).flatMap((group) => (
          (group.models ?? []).map((model) => ({
            ...model,
            provider: group.id,
            providerName: group.name || group.id,
          }))
        )),
      };
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
    async chooseEffort(id) {
      this.effortSheet = false;
      if (!this.modelCurrent) return;
      if (this.chatDevice === "desktop") {
        if (id === this.effortId || this.modelBusy) return;
        this.modelPending = `${this.modelCurrent}\u0000${id ?? ""}`;
        const current = this.models?.default;
        try {
          const selected = await this.runtime.selectModel({
            provider: current.provider,
            model: current.model,
            ...(id === undefined ? {} : { reasoningEffort: id }),
          });
          if (!selected.ok) {
            this.modelError = selected.error?.message || selected.error?.code || "model";
            return;
          }
          this.models = { ...this.models, default: selected.value?.selected ?? current };
        } finally {
          this.modelPending = "";
        }
        return;
      }
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
        if (this.chatDevice === "desktop") {
          const reasoning = reasoningOfModel(model);
          const selection = {
            provider: model.provider,
            model: model.id,
            ...(reasoning?.defaultEffort === undefined
              ? {}
              : { reasoningEffort: reasoning.defaultEffort }),
          };
          const selected = await this.runtime.selectModel(selection);
          if (!selected.ok) throw new Error(selected.error?.message || selected.error?.code || "model");
          this.models = { ...this.models, default: selected.value?.selected ?? selection };
        } else {
          this.models = await this.runtime.settings.setDefaultModel({
            provider: model.provider,
            model: model.id,
          });
        }
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
