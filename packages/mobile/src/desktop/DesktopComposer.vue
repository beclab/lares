<template>
  <form class="desktop-composer" :data-hero="hero ? 'true' : undefined" @submit.prevent>
    <div class="desktop-composer__model-row">
      <LaresPcPopover
        v-if="hero"
        v-model="workspaceOpen"
        class="desktop-composer__workspace-slot"
        :width="240"
        placement="top-start"
      >
        <template #trigger="{ toggle }">
          <button
            type="button"
            class="desktop-composer__model desktop-composer__workspace"
            :disabled="!state.workspacesReady"
            aria-haspopup="menu"
            :aria-expanded="workspaceOpen"
            @mousedown.prevent
            @click="toggle"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3.5 7.5h6l1.6 2H20.5v9H3.5z" />
            </svg>
            <span>{{ workspaceLabel }}</span>
            <ChevronIcon />
          </button>
        </template>
        <div class="desktop-composer__menu">
          <button
            v-for="workspace in state.workspaces"
            :key="workspace.workspaceId"
            type="button"
            class="desktop-composer__option"
            :data-selected="workspace.workspaceId === state.currentWorkspaceId"
            @click="pickWorkspace(workspace.workspaceId)"
          >
            <span>{{ workspace.title || defaultWorkspaceTitle }}</span>
            <CheckIcon v-if="workspace.workspaceId === state.currentWorkspaceId" />
          </button>
        </div>
      </LaresPcPopover>
      <LaresPcPopover
        v-model="modelOpen"
        class="desktop-composer__model-slot"
        :width="260"
        placement="top-end"
      >
        <template #trigger="{ toggle }">
          <button
            type="button"
            class="desktop-composer__model"
            :disabled="state.modelBusy"
            aria-haspopup="menu"
            :aria-expanded="modelOpen"
            @mousedown.prevent
            @click="toggle"
          >
            <span>{{ state.modelLabel }}</span>
            <ChevronIcon />
          </button>
        </template>
        <div class="desktop-composer__menu">
          <p v-if="state.modelError" class="desktop-composer__menu-status">{{ state.modelError }}</p>
          <p v-else-if="!state.models" class="desktop-composer__menu-status">{{ t("agent.loading") }}</p>
          <template v-for="group in state.modelGroups" :key="group.provider">
            <p class="desktop-composer__menu-label">{{ group.name || group.provider }}</p>
            <button
              v-for="model in group.models"
              :key="modelKey(model)"
              type="button"
              class="desktop-composer__option"
              :data-selected="modelKey(model) === state.modelCurrent"
              @click="chooseModel(model)"
            >
              <span>{{ model.name }}</span>
              <CheckIcon v-if="modelKey(model) === state.modelCurrent" />
            </button>
          </template>
        </div>
      </LaresPcPopover>
      <LaresPcPopover v-if="!state.effortDisabled" v-model="effortOpen" :width="180" placement="top-end">
        <template #trigger="{ toggle }">
          <button
            type="button"
            class="desktop-composer__model"
            :disabled="state.modelBusy"
            aria-haspopup="menu"
            :aria-expanded="effortOpen"
            @mousedown.prevent
            @click="toggle"
          >
            <span>{{ state.effortLabel }}</span>
            <ChevronIcon />
          </button>
        </template>
        <div class="desktop-composer__menu">
          <button
            v-for="row in state.effortRows"
            :key="row.key"
            type="button"
            class="desktop-composer__option"
            :data-selected="row.id === state.effortId"
            @click="chooseEffort(row.id)"
          >
            <span>{{ effortName(row) }}</span>
            <CheckIcon v-if="row.id === state.effortId" />
          </button>
        </div>
      </LaresPcPopover>
    </div>

    <LaresDesktopTodos :rows="state.todos || []" :t="t" />
    <LaresDesktopGoal
      :projection="state.goal"
      :busy="state.goalBusy"
      :t="t"
      @action="(kind, value) => $emit('goal-action', kind, value)"
    />
    <LaresDesktopQueue
      :items="state.queue"
      :running="state.running"
      :busy="state.queueBusy"
      :t="t"
      @action="(itemId, action) => $emit('queue-action', itemId, action)"
    />

    <Transition name="lares-panel" mode="out-in">
      <div v-if="state.approval" key="approval" class="desktop-composer__approval">
        <div class="desktop-composer__approval-strip">
          <span aria-hidden="true" />
          {{ t("approval.waiting") }}
        </div>
        <div class="desktop-composer__approval-body">
          {{ state.approval.reason || t("approval.escalation", { toolName: state.approval.toolName }) }}
        </div>
        <div class="desktop-composer__approval-actions">
          <button type="button" :disabled="state.approvalBusy" @click="$emit('answer-approval', 'rejected')">
            {{ t("approval.reject") }}
          </button>
          <button type="button" :disabled="state.approvalBusy" @click="$emit('answer-approval', 'allowed-once')">
            {{ t("approval.allowOnce") }}
          </button>
        </div>
      </div>
      <LaresDesktopQuestions
        v-else-if="state.question?.questions?.length"
        key="questions"
        :questions="state.question.questions"
        :busy="state.questionBusy"
        :t="t"
        @answer="$emit('answer-questions', $event)"
      />
      <div
        v-else
        key="composer"
        class="desktop-composer__card"
        data-composer-card
        @dragover.prevent
        @drop.prevent="onDrop"
        @paste="onPaste"
      >
      <div
        v-if="commandTyped && commandsOpen"
        ref="commandsMenu"
        class="desktop-composer__reference-menu"
        role="listbox"
      >
        <p class="desktop-composer__reference-section">{{ t("desktop.commands") }}</p>
        <p v-if="state.commandsError" class="desktop-composer__reference-status">{{ state.commandsError }}</p>
        <p v-else-if="!state.commands" class="desktop-composer__reference-status">{{ t("agent.loading") }}</p>
        <p v-else-if="visibleCommands.length === 0" class="desktop-composer__reference-status">{{ t("desktop.noCommands") }}</p>
        <div v-else class="desktop-composer__reference-viewport">
          <button
            v-for="(command, index) in visibleCommands"
            :key="command.name"
            type="button"
            class="desktop-composer__reference-item desktop-composer__command-item"
            role="option"
            :aria-selected="index === commandIndex"
            :data-selected="index === commandIndex"
            @mousedown.prevent
            @mouseenter="commandIndex = index"
            @click="pickCommand(command)"
          >
            <span class="desktop-composer__reference-name">/{{ command.name }}</span>
            <span class="desktop-composer__reference-path">{{ command.description || command.hint }}</span>
          </button>
        </div>
      </div>
      <div v-if="referenceOpen" ref="referenceMenu" class="desktop-composer__reference-menu" role="listbox">
        <p v-if="state.referencesError" class="desktop-composer__reference-status">{{ state.referencesError }}</p>
        <p v-else-if="state.referencesLoading" class="desktop-composer__reference-status">{{ t("agent.loading") }}</p>
        <p v-else-if="!state.references.length" class="desktop-composer__reference-status">{{ t("references.empty") }}</p>
        <div v-else class="desktop-composer__reference-viewport">
          <template v-for="(row, index) in referenceRows" :key="row.id">
            <p v-if="row.section" class="desktop-composer__reference-section">{{ row.section }}</p>
            <button
              type="button"
              class="desktop-composer__reference-item"
              role="option"
              :aria-selected="index === referenceIndex"
              :data-selected="index === referenceIndex"
              @mousedown.prevent
              @mouseenter="referenceIndex = index"
              @click="pickReference(row)"
            >
              <span class="desktop-composer__reference-name">{{ row.name }}</span>
              <span class="desktop-composer__reference-path">{{ row.description }}</span>
            </button>
          </template>
        </div>
      </div>
      <div v-if="state.draftImages.length" class="desktop-composer__attachments">
        <figure
          v-for="image in state.draftImages"
          :key="image.id"
          :data-status="imageStatus(image)"
        >
          <button
            type="button"
            class="desktop-composer__attachment-open"
            :aria-label="t('composer.previewAttachment', { name: image.file.name })"
            :disabled="imageStatus(image) !== 'ready'"
            @click="previewImageId = image.id"
          >
            <img :src="image.previewUrl" :alt="image.file.name" />
          </button>
          <div v-if="imageStatus(image) === 'uploading'" class="desktop-composer__attachment-overlay">
            <svg class="desktop-composer__attachment-spin" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6" />
            </svg>
          </div>
          <div v-else-if="imageStatus(image) === 'failed'" class="desktop-composer__attachment-overlay" data-kind="error">
            <span aria-hidden="true">!</span>
          </div>
          <button
            type="button"
            class="desktop-composer__attachment-remove"
            :aria-label="t('composer.removeAttachment', { name: image.file.name })"
            @click="$emit('remove-image', image.id)"
          >
            <CloseIcon />
          </button>
        </figure>
      </div>
      <textarea
        ref="input"
        :value="state.draft"
        class="desktop-composer__input"
        rows="1"
        :placeholder="placeholder"
        :disabled="state.modelBlocked"
        :readonly="state.sending"
        @input="onInput"
        @keydown="onKeydown"
        @wheel="onWheel"
      />
      <div class="desktop-composer__footer">
        <input ref="picker" type="file" multiple class="desktop-composer__picker" @change="onFiles" />
        <LaresPcPopover v-model="commandsButtonOpen" :width="380" placement="top-start">
          <template #trigger="{ toggle }">
            <LaresPcTooltip :label="t('desktop.commands')" placement="top">
              <button
                type="button"
                class="desktop-composer__circle"
                :disabled="attachDisabled"
                aria-haspopup="menu"
                :aria-expanded="commandsButtonOpen"
                :aria-label="t('desktop.commands')"
                @mousedown.prevent
                @click="openCommands(toggle)"
              >
                <PlusIcon />
              </button>
            </LaresPcTooltip>
          </template>
          <div class="desktop-composer__menu">
            <p class="desktop-composer__menu-label">{{ t("desktop.commands") }}</p>
            <p v-if="state.commandsError" class="desktop-composer__menu-status">{{ state.commandsError }}</p>
            <p v-else-if="!state.commands" class="desktop-composer__menu-status">{{ t("agent.loading") }}</p>
            <p v-else-if="visibleCommands.length === 0" class="desktop-composer__menu-status">{{ t("desktop.noCommands") }}</p>
            <button
              v-for="(command, index) in visibleCommands"
              :key="command.name"
              type="button"
              class="desktop-composer__command"
              :data-selected="index === commandIndex"
              @mouseenter="commandIndex = index"
              @click="pickCommand(command)"
            >
              <span class="desktop-composer__command-name">/{{ command.name }}</span>
              <span class="desktop-composer__command-hint">{{ command.description || command.hint }}</span>
            </button>
          </div>
        </LaresPcPopover>
        <LaresPcPopover
          v-if="state.permissionRows.length"
          v-model="permissionOpen"
          class="desktop-composer__permission-slot"
          :width="240"
          placement="top-start"
        >
          <template #trigger="{ toggle }">
            <LaresPcTooltip :label="state.permissionHint" placement="top">
              <button
                type="button"
                class="desktop-composer__permission"
                :disabled="state.permissionBusy"
                :data-open="permissionOpen"
                aria-haspopup="menu"
                :aria-expanded="permissionOpen"
                @mousedown.prevent
                @click="toggle"
              >
                <PermissionIcon :preset="state.permissionCurrent" />
                <span>{{ state.permissionLabel }}</span>
                <ChevronIcon class="desktop-composer__caret" />
              </button>
            </LaresPcTooltip>
          </template>
          <div class="desktop-composer__menu">
            <LaresPcTooltip
              v-for="row in state.permissionRows"
              :key="row.value"
              :label="row.hint"
              placement="right"
            >
              <button
                type="button"
                class="desktop-composer__option"
                :data-selected="row.value === state.permissionCurrent"
                @click="choosePermission(row.value)"
              >
                <span class="desktop-composer__option-main">
                  <PermissionIcon :preset="row.value" />
                  <span>{{ row.label }}</span>
                </span>
                <CheckIcon v-if="row.value === state.permissionCurrent" />
              </button>
            </LaresPcTooltip>
          </div>
        </LaresPcPopover>
        <LaresPcTooltip v-if="state.planActive" :label="t('plan.disable')" placement="top">
          <button
            type="button"
            class="desktop-composer__plan"
            :disabled="state.sending"
            :aria-label="t('plan.disable')"
            @mousedown.prevent
            @click="$emit('disable-plan')"
          >
            <span>{{ t("plan.active") }}</span>
            <CloseIcon />
          </button>
        </LaresPcTooltip>
        <LaresPcTooltip :label="t('composer.attach')" placement="top">
          <button
            type="button"
            class="desktop-composer__circle"
            :disabled="attachDisabled"
            :aria-label="t('composer.attach')"
            @mousedown.prevent
            @click="$refs.picker?.click()"
          >
            <PaperclipIcon />
          </button>
        </LaresPcTooltip>
        <LaresDesktopContextMeter
          class="desktop-composer__meter"
          :pressure="state.contextPressure"
          :breakdown="state.contextBreakdown"
          :t="t"
        />
        <LaresPcTooltip
          class="desktop-composer__send-slot"
          :label="state.running ? t('chat.stop') : t('chat.send')"
          placement="top"
        >
          <button
            type="button"
            class="desktop-composer__send"
            :disabled="state.running ? state.stopping : !state.canSend || state.sending"
            :aria-label="state.running ? t('chat.stop') : t('chat.send')"
            @mousedown.prevent
            @click="primary"
          >
            <StopIcon v-if="state.running" />
            <ArrowIcon v-else />
          </button>
        </LaresPcTooltip>
      </div>
      </div>
    </Transition>
    <p v-for="item in state.upload.failures" :key="item.id" class="desktop-composer__error">
      {{ t("upload.failed", { name: item.name, reason: t(`error.${item.code}`) }) }}
    </p>
    <LaresPcDialog
      :open="permissionConfirm"
      :title="t('access.confirm.title')"
      :description="t('access.confirm.description')"
      :close-label="t('access.confirm.cancel')"
      :width="460"
      @close="closePermissionConfirm"
    >
      <label class="desktop-composer__risk-check">
        <input v-model="permissionAcknowledged" type="checkbox" />
        <span>{{ t("access.confirm.acknowledge") }}</span>
      </label>
      <template #footer>
        <button type="button" class="desktop-composer__dialog-cancel" @click="closePermissionConfirm">
          {{ t("access.confirm.cancel") }}
        </button>
        <button
          type="button"
          class="desktop-composer__dialog-confirm"
          :disabled="!permissionAcknowledged || state.permissionBusy"
          @click="confirmPermission"
        >
          {{ t("access.confirm.enable") }}
        </button>
      </template>
    </LaresPcDialog>
    <LaresPcDialog
      :open="Boolean(previewImage)"
      :title="previewImage?.file.name ?? ''"
      :close-label="t('desktop.close')"
      :width="720"
      @close="previewImageId = ''"
    >
      <img
        v-if="previewImage"
        class="desktop-composer__preview"
        :src="previewImage.previewUrl"
        :alt="previewImage.file.name"
      />
    </LaresPcDialog>
  </form>
</template>

<script>
import { h } from "vue";
import { resolveSubmitMode } from "@olares/lares-core/larepass/submission-settings";
import { DEFAULT_WORKSPACE_TITLE } from "@olares/lares-core/workspace/constants";
import { activeReferenceToken, insertReference } from "@olares/lares-core/larepass/references";
import { draftImageStatus } from "@olares/lares-core/files/draft-images";
import LaresDesktopQueue from "./DesktopQueue.vue";
import LaresDesktopQuestions from "./DesktopQuestions.vue";
import LaresDesktopContextMeter from "./DesktopContextMeter.vue";
import LaresDesktopGoal from "./DesktopGoal.vue";
import LaresDesktopTodos from "./DesktopTodos.vue";
import LaresPcDialog from "./ui/PcDialog.vue";
import LaresPcPopover from "./ui/PcPopover.vue";
import LaresPcTooltip from "./ui/PcTooltip.vue";

const icon = (name, ...paths) => ({
  name,
  render() {
    return h("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, paths.map((d) => h("path", { d })));
  },
});

const ChevronIcon = icon("ChevronIcon", "m8 10 4 4 4-4");
const CheckIcon = icon("CheckIcon", "m5 12.5 4 4 10-10");
const PlusIcon = icon("PlusIcon", "M12 5v14M5 12h14");
const PaperclipIcon = icon("PaperclipIcon", "m9.5 12.5 5.8-5.8a3 3 0 0 1 4.2 4.2l-8.1 8.1a5 5 0 0 1-7.1-7.1l8-8");
const ArrowIcon = icon("ArrowIcon", "M12 19V7M6.5 12.5 12 7l5.5 5.5");
const StopIcon = {
  name: "StopIcon",
  render() {
    return h("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, [
      h("rect", { x: 7, y: 7, width: 10, height: 10, rx: 2.5, fill: "currentColor", stroke: "none" }),
    ]);
  },
};
const CloseIcon = icon("CloseIcon", "m7 7 10 10M17 7 7 17");

const SHIELD = "M12 3.5 19 6v5.4c0 4.2-2.8 7.4-7 9.1-4.2-1.7-7-4.9-7-9.1V6l7-2.5Z";
/** One shield, three glyphs: what this preset lets a tool do. */
const PRESET_GLYPHS = {
  "read-only": "m9.2 12 1.8 1.8 3.8-4",
  "workspace-write": "m9.6 13.9 4.3-4.3 1.4 1.4-4.3 4.3H9.6z",
  "danger-full-access": "M12 8.4v3.8M12 14.8v.1",
};

const PermissionIcon = {
  name: "PermissionIcon",
  props: { preset: { type: String, default: "" } },
  render() {
    const glyph = PRESET_GLYPHS[this.preset] ?? PRESET_GLYPHS["workspace-write"];
    return h("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, [
      h("path", { d: SHIELD }),
      h("path", { d: glyph }),
    ]);
  },
};

export default {
  name: "LaresDesktopComposer",
  components: { LaresDesktopContextMeter, LaresDesktopGoal, LaresDesktopQuestions, LaresDesktopQueue, LaresDesktopTodos, LaresPcDialog, LaresPcPopover, LaresPcTooltip, ChevronIcon, CheckIcon, PlusIcon, PaperclipIcon, ArrowIcon, StopIcon, CloseIcon, PermissionIcon },
  props: {
    state: { type: Object, required: true },
    t: { type: Function, required: true },
    hero: { type: Boolean, default: false },
    modelKey: { type: Function, required: true },
    effortName: { type: Function, required: true },
  },
  emits: [
    "update-draft", "send", "stop", "steer-queue", "files", "choose-model", "choose-effort", "answer-approval", "answer-questions",
    "choose-permission", "disable-plan", "goal-action", "open-commands", "pick-command", "queue-action", "remove-image", "pick-workspace",
  ],
  data() {
    return {
      modelOpen: false,
      workspaceOpen: false,
      effortOpen: false,
      permissionOpen: false,
      permissionConfirm: false,
      permissionAcknowledged: false,
      commandsOpen: false,
      commandsButtonOpen: false,
      commandTyped: false,
      commandIndex: 0,
      dropping: false,
      dropDepth: 0,
      referenceOpen: false,
      referenceToken: null,
      referenceIndex: 0,
      referenceTimer: 0,
      previewImageId: "",
    };
  },
  computed: {
    defaultWorkspaceTitle() {
      return DEFAULT_WORKSPACE_TITLE;
    },
    workspaceLabel() {
      if (!this.state.workspacesReady) return this.t("agent.loading");
      const current = this.state.workspaces.find(
        (row) => row.workspaceId === this.state.currentWorkspaceId,
      );
      return current?.title || this.state.workspaces[0]?.title || DEFAULT_WORKSPACE_TITLE;
    },
    /** Held by id, so removing or sending the draft closes the dialog. */
    previewImage() {
      return this.state.draftImages.find((row) => row.id === this.previewImageId) ?? null;
    },
    /** Row chrome follows dsh's `@` menu: "<kind> · <name>" plus a section break. */
    referenceRows() {
      let previous = "";
      return this.state.references.map((row) => {
        const group = row.kind === "session" ? "sessions" : "files";
        const section = group === previous ? "" : this.t(`references.section.${group}`);
        previous = group;
        return { ...row, section, name: `${this.t(`references.${row.kind}`)} · ${row.label}` };
      });
    },
    attachDisabled() {
      return !this.state.sessionId || this.state.historyLoading || this.state.starting;
    },
    visibleCommands() {
      const rows = this.state.commands || [];
      if (!this.commandTyped) return rows;
      const needle = this.state.draft.match(/^\/([^\s]*)$/)?.[1]?.toLowerCase() ?? "";
      return rows.filter((row) => row.name.toLowerCase().includes(needle));
    },
    composerOverlayPointerActive() {
      return this.referenceOpen || (this.commandsOpen && this.commandTyped);
    },
    placeholder() {
      if (this.state.modelBlocked) return this.t("chat.placeholderNoModel");
      if (
        this.state.running
        && !this.state.draft.trim()
        && !this.state.draftImages.length
        && this.state.queue.some((row) => row.placement === "queued")
      ) {
        const shortcut = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || "")
          ? "⌘↵"
          : "Ctrl+Enter";
        return this.t("chat.placeholderSteerQueue", { shortcut });
      }
      if (this.state.planActive) return this.t("chat.placeholderPlan");
      if (this.hero) return this.t("chat.placeholderNewSession");
      return this.t("chat.placeholderDesktop");
    },
  },
  watch: {
    "state.draft"() {
      this.autosize();
    },
    composerOverlayPointerActive(active) {
      if (active) window.addEventListener("mousedown", this.onComposerOverlayPointer, true);
      else window.removeEventListener("mousedown", this.onComposerOverlayPointer, true);
    },
  },
  mounted() {
    this.autosize();
  },
  beforeUnmount() {
    window.clearTimeout(this.referenceTimer);
    window.removeEventListener("mousedown", this.onComposerOverlayPointer, true);
  },
  methods: {
    pickWorkspace(workspaceId) {
      this.workspaceOpen = false;
      if (!workspaceId || workspaceId === this.state.currentWorkspaceId) return;
      this.$emit("pick-workspace", workspaceId);
    },
    chooseModel(model) {
      this.modelOpen = false;
      this.$emit("choose-model", model);
    },
    chooseEffort(id) {
      this.effortOpen = false;
      this.$emit("choose-effort", id);
    },
    choosePermission(value) {
      this.permissionOpen = false;
      if (value === this.state.permissionCurrent) return;
      if (value === "danger-full-access") {
        this.permissionAcknowledged = false;
        this.permissionConfirm = true;
        return;
      }
      this.$emit("choose-permission", value);
    },
    closePermissionConfirm() {
      this.permissionConfirm = false;
      this.permissionAcknowledged = false;
    },
    confirmPermission() {
      if (!this.permissionAcknowledged || this.state.permissionBusy) return;
      this.closePermissionConfirm();
      this.$emit("choose-permission", "danger-full-access");
    },
    /** The registry is read when the menu opens, not on every keystroke. */
    openCommands(toggle) {
      const opening = !this.commandsButtonOpen;
      this.commandTyped = false;
      this.commandsOpen = false;
      this.commandIndex = 0;
      toggle();
      if (opening) this.$emit("open-commands");
    },
    pickCommand(command) {
      this.commandsOpen = false;
      this.commandsButtonOpen = false;
      this.commandTyped = false;
      this.$emit("pick-command", command);
    },
    onInput(event) {
      const value = event.target.value;
      this.$emit("update-draft", value);
      this.trackReference(value, event.target.selectionStart ?? value.length);
      const typed = /^\/[^\s]*$/.test(value);
      if (typed) {
        if (!this.commandsOpen) this.$emit("open-commands");
        this.commandsButtonOpen = false;
        this.commandTyped = true;
        this.commandIndex = 0;
        this.commandsOpen = true;
      } else if (this.commandTyped) {
        this.commandTyped = false;
        this.commandsOpen = false;
      }
    },
    closeReferences() {
      window.clearTimeout(this.referenceTimer);
      this.referenceOpen = false;
      this.referenceToken = null;
    },
    /**
     * A press outside dismisses the panel; one inside the textarea only moves
     * the caret, which decides on its own whether a mention is still under it.
     */
    onComposerOverlayPointer(event) {
      if (this.$refs.referenceMenu?.contains(event.target)) return;
      if (this.$refs.commandsMenu?.contains(event.target)) return;
      const input = this.$refs.input;
      if (event.target !== input) {
        this.closeReferences();
        if (this.commandTyped) {
          this.commandsOpen = false;
          this.commandTyped = false;
        }
        return;
      }
      window.setTimeout(() => {
        if (this.referenceOpen) this.trackReference(this.state.draft, input.selectionStart ?? 0);
      }, 0);
    },
    trackReference(value, caret) {
      const token = activeReferenceToken(value, caret);
      window.clearTimeout(this.referenceTimer);
      if (!token) {
        this.closeReferences();
        return;
      }
      this.commandsOpen = false;
      this.commandsButtonOpen = false;
      this.commandTyped = false;
      this.referenceOpen = true;
      this.referenceToken = token;
      this.referenceIndex = 0;
      this.referenceTimer = window.setTimeout(() => {
        this.$emit("open-references", { query: token.query, quoted: token.quoted });
      }, 100);
    },
    pickReference(row) {
      if (!this.referenceToken) return;
      const inserted = insertReference(this.state.draft, this.referenceToken, row);
      this.$emit("update-draft", inserted.draft);
      this.$nextTick(() => {
        const input = this.$refs.input;
        input?.focus();
        input?.setSelectionRange(inserted.caret, inserted.caret);
        if (row.continuation) this.trackReference(inserted.draft, inserted.caret);
        else this.closeReferences();
      });
    },
    focus() {
      this.$refs.input?.focus();
    },
    imageStatus(image) {
      return draftImageStatus(image);
    },
    onFiles(event) {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = "";
      if (files.length) this.$emit("files", files);
    },
    onPaste(event) {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (!files.length) return;
      event.preventDefault();
      this.$emit("files", files);
    },
    onDrop(event) {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) this.$emit("files", files);
    },
    onKeydown(event) {
      if (this.referenceOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          this.closeReferences();
          return;
        }
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && this.state.references.length) {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          this.referenceIndex = (
            this.referenceIndex + step + this.state.references.length
          ) % this.state.references.length;
          return;
        }
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing && this.state.references.length) {
          event.preventDefault();
          this.pickReference(this.state.references[this.referenceIndex] ?? this.state.references[0]);
          return;
        }
      }
      if (this.commandsOpen || this.commandsButtonOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          this.commandsOpen = false;
          this.commandsButtonOpen = false;
          this.commandTyped = false;
          return;
        }
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && this.visibleCommands.length) {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          this.commandIndex = (this.commandIndex + step + this.visibleCommands.length) % this.visibleCommands.length;
          return;
        }
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing && this.visibleCommands.length) {
          event.preventDefault();
          this.pickCommand(this.visibleCommands[this.commandIndex] ?? this.visibleCommands[0]);
          return;
        }
      }
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      const accelerated = event.metaKey || event.ctrlKey;
      if (accelerated && this.state.running && !this.state.canSend) {
        if (this.state.queue.some((row) => row.placement === "queued")) this.$emit("steer-queue");
        return;
      }
      if (this.state.canSend) {
        this.$emit("send", resolveSubmitMode(
          this.state.running,
          accelerated,
          true,
          this.state.busyEnter,
        ));
      }
    },
    onWheel(event) {
      const input = event.currentTarget;
      const atTop = input.scrollTop <= 0 && event.deltaY < 0;
      const atBottom = input.scrollTop + input.clientHeight >= input.scrollHeight - 1 && event.deltaY > 0;
      if (!atTop && !atBottom) return;
      const log = document.querySelector(".lares-log");
      if (!log) return;
      log.scrollTop += event.deltaY;
      event.preventDefault();
    },
    primary() {
      this.$emit(this.state.running ? "stop" : "send");
    },
    autosize() {
      this.$nextTick(() => {
        const input = this.$refs.input;
        if (!input) return;
        input.style.height = "auto";
        input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
      });
    },
  },
};
</script>

<style scoped>
.desktop-composer {
  position: relative;
  z-index: 2;
  width: calc(var(--lares-column, min(760px, 100%)) - 2 * var(--lares-gutter, 24px));
  margin: 0 auto;
  padding: 8px 0 20px;
}
.desktop-composer__model-row { display:flex; justify-content:flex-end; gap:2px; min-height:28px; margin-bottom:6px; }
.desktop-composer[data-hero="true"] .desktop-composer__model-row { justify-content:space-between; }
.desktop-composer__model,
.desktop-composer__circle,
.desktop-composer__send {
  border:0; color:var(--q-ink-2); cursor:pointer;
}
.desktop-composer__model { display:flex; align-items:center; gap:4px; border-radius:999px; padding:4px 10px; background:transparent; font-size:14px; }
/* The model name is the long label of the pair, so it is the one that gives way;
   without a floor of its own the workspace chip absorbs every pixel of shrink. */
.desktop-composer__workspace-slot { flex:0 0 auto; max-width:45%; }
.desktop-composer__model-slot { min-width:0; }
.desktop-composer__workspace,
.desktop-composer__model-slot .desktop-composer__model { min-width:0; max-width:100%; }
.desktop-composer__workspace span,
.desktop-composer__model-slot .desktop-composer__model span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.desktop-composer__model svg,
.desktop-composer__permission svg,
.desktop-composer__circle svg,
.desktop-composer__send svg,
.desktop-composer__option svg { width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
.desktop-composer__card { position:relative; border:1px solid var(--q-input-stroke); border-radius:14px; padding:10px 12px 9px; background:var(--q-background-2, var(--q-background-1)); box-shadow:0 1px 3px rgb(0 0 0 / 8%); }
.desktop-composer__card[data-dropping="true"] { border-color:var(--q-blue-default); background:color-mix(in srgb, var(--q-blue-default) 8%, var(--q-background-2, var(--q-background-1))); }
/* Metrics mirror dsh's `@` menu (MenuView.module.css); only the palette is the
   LarePass shell's, since dsh's --dsw-* tokens do not exist here. */
.desktop-composer__reference-menu { position:absolute; z-index:20; bottom:calc(100% + 4px); left:0; display:flex; min-width:min(260px, 100%); max-width:min(537px, 100%); max-height:320px; flex-direction:column; overflow:hidden; border:1px solid var(--q-separator); border-radius:12px; padding:4px; background:var(--q-background-1); box-shadow:0 12px 30px rgb(0 0 0 / 18%); }
.desktop-composer__reference-viewport { display:flex; min-height:0; flex-direction:column; overflow-y:auto; }
.desktop-composer__reference-status { display:flex; min-height:40px; align-items:center; margin:0; padding:8px 10px; color:var(--q-ink-3); font-size:14px; line-height:22px; }
.desktop-composer__reference-section { min-height:26px; flex:none; margin:0; padding:6px 10px 2px; color:var(--q-ink-3); font-size:12px; font-weight:500; line-height:18px; }
.desktop-composer__reference-section:not(:first-child) { margin-top:4px; }
.desktop-composer__reference-item { display:flex; width:100%; min-height:40px; align-items:center; gap:8px; border:0; border-radius:10px; padding:8px 10px; background:transparent; color:var(--q-ink-1); font:inherit; font-size:14px; line-height:22px; text-align:left; cursor:pointer; }
.desktop-composer__reference-item:hover,
.desktop-composer__reference-item[data-selected="true"] { background:var(--q-background-hover); }
.desktop-composer__reference-name { max-width:40%; flex:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.desktop-composer__reference-path { min-width:0; flex:1; overflow:hidden; color:var(--q-ink-3); text-overflow:ellipsis; white-space:nowrap; }
.desktop-composer__approval { overflow:hidden; border:1px solid var(--q-separator); border-radius:14px; background:var(--q-background-2); box-shadow:0 1px 3px rgb(0 0 0 / 8%); }
.desktop-composer__approval-strip { display:flex; height:30px; align-items:center; gap:7px; padding:0 12px; background:var(--q-background-3); color:var(--q-ink-3); font-size:12px; }
.desktop-composer__approval-strip span { width:6px; height:6px; border-radius:50%; background:var(--q-orange-default); }
.desktop-composer__approval-body { max-height:96px; overflow:auto; padding:14px 16px; color:var(--q-ink-1); font-size:14px; line-height:20px; }
.desktop-composer__approval-actions { display:flex; justify-content:flex-end; gap:8px; padding:8px 12px 12px; }
.desktop-composer__approval-actions button { height:32px; border:1px solid var(--q-separator); border-radius:7px; padding:0 13px; background:transparent; color:var(--q-ink-2); font:inherit; cursor:pointer; }
.desktop-composer__approval-actions button:last-child { border-color:transparent; background:var(--q-blue-default); color:var(--q-ink-on-brand); }
.desktop-composer__approval-actions button:disabled { opacity:.45; cursor:default; }
.desktop-composer__attachments { display:flex; gap:8px; overflow-x:auto; padding:0 0 8px 2px; }
.desktop-composer__attachments figure { position:relative; width:64px; height:64px; flex:0 0 64px; overflow:hidden; margin:0; border:1px solid var(--q-separator); border-radius:9px; background:var(--q-background-3); }
.desktop-composer__attachments img { width:100%; height:100%; object-fit:cover; transition:opacity .22s ease; }
.desktop-composer__attachments figure[data-status="failed"] { border-color:var(--q-orange-default); }
.desktop-composer__attachment-overlay { position:absolute; inset:0; display:grid; place-items:center; background:rgb(0 0 0 / 42%); color:white; pointer-events:none; }
.desktop-composer__attachment-overlay[data-kind="error"] { font-size:16px; font-weight:700; }
.desktop-composer__attachment-spin { width:18px; height:18px; animation:desktop-attachment-spin .8s linear infinite; }
.desktop-composer__attachment-spin circle { fill:none; stroke:currentColor; stroke-dasharray:24 12; }
@keyframes desktop-attachment-spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .desktop-composer__attachment-spin { animation:none; } }
.desktop-composer__attachment-open { display:block; width:100%; height:100%; border:0; padding:0; background:transparent; cursor:zoom-in; }
.desktop-composer__attachment-remove { position:absolute; top:3px; right:3px; display:grid; width:20px; height:20px; place-items:center; border:0; border-radius:50%; padding:0; background:rgb(0 0 0 / 58%); color:white; cursor:pointer; }
.desktop-composer__attachment-remove svg { width:12px; height:12px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; }
.desktop-composer__preview { display:block; max-width:100%; max-height:calc(100vh - 220px); margin:0 auto; border-radius:8px; }
.desktop-composer__input { box-sizing:border-box; width:100%; min-height:37px; max-height:200px; resize:none; overflow-y:auto; border:0; padding:1px 2px 8px; outline:0; background:transparent; color:var(--q-ink-1); font:inherit; font-size:16px; line-height:1.5; }
.desktop-composer__footer { display:flex; align-items:center; gap:8px; min-height:30px; }
/* The flex items here are the tooltip/popover wrappers, not the buttons. They
   carry min-width:0, so without this the fixed 28px controls get squeezed
   narrower than their own 16px glyph and the icons spill onto their neighbours.
   Only the permission label gives way, by ellipsis. */
.desktop-composer__footer > * { flex-shrink:0; }
.desktop-composer__permission-slot { min-width:0; flex-shrink:1; }
.desktop-composer__permission { min-width:0; }
.desktop-composer__permission svg { flex-shrink:0; }
.desktop-composer__permission span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.desktop-composer__picker { display:none; }
.desktop-composer__circle { display:grid; width:28px; height:28px; place-items:center; border-radius:50%; background:var(--q-background-3); }
.desktop-composer__permission { display:flex; align-items:center; gap:5px; height:28px; border:0; border-radius:999px; padding:0 8px; background:var(--q-background-3); color:var(--q-ink-2); font:inherit; font-size:14px; cursor:pointer; }
.desktop-composer__plan { display:flex; height:28px; align-items:center; gap:4px; border:0; border-radius:999px; padding:0 8px; background:var(--q-background-3); color:var(--q-orange-default); font:inherit; font-size:13px; cursor:pointer; }
.desktop-composer__plan svg { width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; }
.desktop-composer__permission .desktop-composer__caret { transition:transform .15s ease; }
.desktop-composer__permission[data-open="true"] .desktop-composer__caret { transform:rotate(180deg); }
.desktop-composer__model:hover,
.desktop-composer__circle:hover,
.desktop-composer__permission:hover,
.desktop-composer__plan:hover { background:var(--q-background-hover); }
/* The meter rides with the send button; it renders nothing without an occupancy,
   in which case the send button keeps the auto margin itself. */
.desktop-composer__meter { margin-left:auto; }
.desktop-composer__send-slot { margin-left:auto; }
.desktop-composer__meter + .desktop-composer__send-slot { margin-left:0; }
.desktop-composer__send { display:grid; width:28px; height:28px; place-items:center; border-radius:50%; background:var(--q-blue-default); color:var(--q-ink-on-brand); }
.desktop-composer button:disabled { opacity:.45; cursor:default; }
.desktop-composer__menu { margin:-2px; }
.desktop-composer__menu-label,
.desktop-composer__menu-status { margin:0; padding:7px 8px 4px; color:var(--q-ink-3); font-size:13px; }
.desktop-composer__option { display:flex; align-items:center; justify-content:space-between; width:100%; border:0; border-radius:6px; padding:7px 8px; background:transparent; color:var(--q-ink-2); text-align:left; cursor:pointer; }
/* Menu rows are wrapped in a tooltip; the wrapper must fill the panel. Footer
   tooltips are flex items and must keep their own width. */
.desktop-composer__menu :deep(.lares-pc-tooltip) { width:100%; }
.desktop-composer__option:hover { background:var(--q-background-hover); }
.desktop-composer__option[data-selected="true"] { color:var(--q-blue-default); }
.desktop-composer__option-main { display:flex; min-width:0; align-items:center; gap:8px; }
.desktop-composer__option-main span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.desktop-composer__command { display:flex; align-items:baseline; gap:10px; width:100%; border:0; border-radius:6px; padding:7px 8px; background:transparent; color:var(--q-ink-2); font:inherit; text-align:left; cursor:pointer; }
.desktop-composer__command:hover { background:var(--q-background-hover); }
.desktop-composer__command[data-selected="true"] { background:var(--q-background-hover); }
.desktop-composer__command-name { flex-shrink:0; color:var(--q-ink-1); font-size:15px; }
.desktop-composer__command-hint { min-width:0; overflow:hidden; color:var(--q-ink-3); font-size:14px; text-overflow:ellipsis; white-space:nowrap; }
.desktop-composer__error { margin:5px 4px 0; color:var(--q-orange-default); font-size:14px; }
.desktop-composer__risk-check { display:flex; align-items:flex-start; gap:10px; color:var(--q-ink-2); font-size:14px; line-height:20px; cursor:pointer; }
.desktop-composer__risk-check input { width:16px; height:16px; margin:2px 0 0; accent-color:var(--q-blue-default); }
.desktop-composer__dialog-cancel,
.desktop-composer__dialog-confirm { min-width:76px; height:32px; border-radius:7px; padding:0 12px; font:inherit; cursor:pointer; }
.desktop-composer__dialog-cancel { border:1px solid var(--q-separator); background:transparent; color:var(--q-ink-2); }
.desktop-composer__dialog-confirm { border:0; background:var(--q-blue-default); color:var(--q-ink-on-brand); }
.desktop-composer__dialog-confirm:disabled { opacity:.45; cursor:default; }
</style>
