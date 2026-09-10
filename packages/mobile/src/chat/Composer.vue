<template>
  <form class="lares-composer" :class="{ 'lares-composer--hero': hero }" @submit.prevent="onSend">
    <div
      class="lares-composer__card"
      data-composer-card
      :data-hero="hero ? 'true' : 'false'"
      :data-holding="holding ? 'true' : 'false'"
    >
      <div v-if="referenceOpen" ref="referenceMenu" class="lares-composer__menu" role="listbox">
        <p v-if="referencesError" class="lares-composer__menu-status">{{ referencesError }}</p>
        <p v-else-if="referencesLoading" class="lares-composer__menu-status">{{ t("agent.loading") }}</p>
        <p v-else-if="!references.length" class="lares-composer__menu-status">{{ t("references.empty") }}</p>
        <div v-else class="lares-composer__menu-scroll">
          <template v-for="(row, index) in referenceMenuRows" :key="row.id">
            <p v-if="row.section" class="lares-composer__menu-section">{{ row.section }}</p>
            <button
              type="button"
              class="lares-composer__menu-item"
              role="option"
              :aria-selected="index === referenceIndex"
              :data-selected="index === referenceIndex"
              @mousedown.prevent
              @click="pickReference(row)"
            >
              <span class="lares-composer__menu-name">{{ row.name }}</span>
              <span class="lares-composer__menu-path">{{ row.description }}</span>
            </button>
          </template>
        </div>
      </div>
      <div v-if="commandsOpen" ref="commandsMenu" class="lares-composer__menu" role="listbox">
        <p class="lares-composer__menu-section">{{ t("desktop.commands") }}</p>
        <p v-if="commandsError" class="lares-composer__menu-status">{{ commandsError }}</p>
        <p v-else-if="!commands" class="lares-composer__menu-status">{{ t("agent.loading") }}</p>
        <div v-else-if="commandMenuRows.length" class="lares-composer__menu-scroll">
          <button
            v-for="(command, index) in commandMenuRows"
            :key="command.name"
            type="button"
            class="lares-composer__menu-item lares-composer__menu-item--command"
            role="option"
            :aria-selected="index === commandIndex"
            :data-selected="index === commandIndex"
            @mousedown.prevent
            @click="pickCommand(command)"
          >
            <span class="lares-composer__command-name">/{{ command.name }}</span>
            <span class="lares-composer__command-hint">{{ command.description || command.hint }}</span>
          </button>
        </div>
      </div>
      <div v-if="draftImages.length" class="lares-composer__attachments">
        <figure
          v-for="image in draftImages"
          :key="image.id"
          :data-status="imageStatus(image)"
        >
          <img
            :src="image.previewUrl"
            :alt="image.file?.name || ''"
            class="lares-composer__attachment-img"
          />
          <div v-if="imageStatus(image) === 'uploading'" class="lares-composer__attachment-overlay">
            <svg class="lares-composer__spin" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6" />
            </svg>
          </div>
          <div v-else-if="imageStatus(image) === 'failed'" class="lares-composer__attachment-overlay" data-kind="error">
            <span aria-hidden="true">!</span>
          </div>
          <button
            type="button"
            class="lares-composer__attachment-remove"
            :aria-label="t('composer.removeAttachment', { name: image.file?.name || t('composer.attach') })"
            @click="$emit('remove-image', image.id)"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4.5 4.5 7 7m0-7-7 7" />
            </svg>
          </button>
        </figure>
      </div>
      <textarea
        ref="input"
        :value="draft"
        class="lares-composer__input"
        rows="1"
        :placeholder="placeholder"
        :disabled="sending"
        @input="onInput"
        @keydown="onKeydown"
        @click="onCaretMove"
        @keyup="onCaretMove"
        @select="onCaretMove"
        @pointerdown="onHoldDown"
        @pointerup="onHoldUp"
        @pointercancel="onHoldUp"
        @contextmenu="onContextMenu"
      />
      <p v-if="holding" class="lares-composer__hold">{{ t("composer.hold") }} · {{ elapsed }}</p>
      <div class="lares-composer__bar">
        <div v-if="!hero" class="lares-composer__pills">
          <button
            type="button"
            class="lares-composer__pill"
            :disabled="modelBusy"
            :aria-label="modelAria"
            @click="$emit('model')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="5" width="16" height="5" rx="1.2" />
              <rect x="4" y="14" width="16" height="5" rx="1.2" />
            </svg>
            <span>{{ modelLabel }}</span>
          </button>
          <button
            v-if="!effortDisabled"
            type="button"
            class="lares-composer__pill"
            :disabled="modelBusy"
            :aria-label="effortAria"
            @click="$emit('effort')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle class="lares-composer__nucleus" cx="12" cy="12" r="2.5" />
              <ellipse cx="12" cy="12" rx="9.2" ry="3.8" />
              <ellipse cx="12" cy="12" rx="9.2" ry="3.8" transform="rotate(60 12 12)" />
              <ellipse cx="12" cy="12" rx="9.2" ry="3.8" transform="rotate(-60 12 12)" />
            </svg>
            <span>{{ effortLabel }}</span>
          </button>
        </div>
        <div class="lares-composer__tools">
          <input
            ref="picker"
            type="file"
            multiple
            class="lares-composer__picker"
            @change="onFiles"
          />
          <button
            type="button"
            class="lares-composer__icon"
            :disabled="attachDisabled"
            :aria-label="attachLabel"
            @click="pickFiles"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button
            type="submit"
            class="lares-composer__icon"
            data-kind="send"
            :disabled="sending || !canSend"
            :aria-label="t('chat.send')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 19V7M6.5 12.5 12 7l5.5 5.5" />
            </svg>
          </button>
          <!-- Voice input parked.
          <button
            v-if="!showSend"
            type="button"
            class="lares-composer__icon"
            data-kind="voice"
            :data-phase="voicePhase"
            :disabled="voiceBlocked"
            :aria-label="voiceLabel"
            @click="$emit('voice')"
          >
            <span v-if="voicePhase === 'recording'" class="lares-composer__live">{{ elapsed }}</span>
            <svg v-else-if="voicePhase === 'transcribing'" class="lares-composer__spin" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6" />
            </svg>
            <svg v-else class="lares-composer__wave" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6.5 9v6" />
              <path d="M12 4.5v15" />
              <path d="M17.5 9v6" />
            </svg>
          </button>
          -->
        </div>
      </div>
    </div>
    <!-- <p v-if="voiceError" class="lares-composer__hint" data-status="error">{{ voiceError }}</p> -->
    <p v-for="item in failures" :key="item.id" class="lares-composer__hint" data-status="error">
      {{ t("upload.failed", { name: item.name, reason: t(`error.${item.code}`) }) }}
    </p>
  </form>
</template>

<script>
import { formatElapsed } from "./voice.js";
import {
  REFERENCE_DEBOUNCE_MS,
  activeReference,
  applyReference,
  isCommandLine,
  referenceRows,
  visibleCommands,
} from "./composer-tokens.js";
import { draftImageStatus } from "@olares/lares-core/files/draft-images";

const HOLD_MS = 240;

export default {
  name: "LaresComposer",
  props: {
    draft: { type: String, default: "" },
    sending: { type: Boolean, default: false },
    canSend: { type: Boolean, default: false },
    modelLabel: { type: String, default: "" },
    modelBusy: { type: Boolean, default: false },
    effortLabel: { type: String, default: "" },
    effortDisabled: { type: Boolean, default: false },
    attachPending: { type: Boolean, default: false },
    attachDisabled: { type: Boolean, default: false },
    voicePhase: { type: String, default: "idle" },
    voiceElapsed: { type: Number, default: 0 },
    voiceError: { type: String, default: "" },
    failures: { type: Array, default: () => [] },
    draftImages: { type: Array, default: () => [] },
    references: { type: Array, default: () => [] },
    referencesLoading: { type: Boolean, default: false },
    referencesError: { type: String, default: "" },
    commands: { type: Array, default: null },
    commandsError: { type: String, default: "" },
    hero: { type: Boolean, default: false },
    t: { type: Function, required: true },
  },
  emits: [
    "update:draft", "send", "model", "effort", "files", "voice", "hold-start", "hold-end",
    "open-commands", "open-references", "pick-command", "remove-image",
  ],
  data() {
    return {
      holding: false,
      holdTimer: 0,
      commandsOpen: false,
      commandTyped: false,
      commandIndex: 0,
      referenceOpen: false,
      referenceToken: null,
      referenceIndex: 0,
      referenceTimer: 0,
    };
  },
  computed: {
    showSend() {
      return Boolean(this.draft.trim()) && this.voicePhase !== "recording" && !this.holding;
    },
    elapsed() {
      return formatElapsed(this.voiceElapsed);
    },
    modelAria() {
      return this.modelLabel ? this.t("model.switchAria", { label: this.modelLabel }) : this.t("model.select");
    },
    effortAria() {
      return this.t("reasoning.switchAria", { label: this.effortLabel || this.t("reasoning.default") });
    },
    attachLabel() {
      return this.attachPending ? this.t("button.uploading", { count: 1 }) : this.t("composer.attach");
    },
    placeholder() {
      if (this.hero) return this.t("chat.placeholderNewSession");
      return this.t("chat.placeholder");
    },
    voiceLabel() {
      if (this.voiceError) return this.voiceError;
      if (this.voicePhase === "recording") return this.t("mic.stop");
      if (this.voicePhase === "transcribing") return this.t("mic.transcribing");
      return this.t("composer.voice");
    },
    voiceBlocked() {
      return this.voicePhase === "transcribing" || this.sending;
    },
    referenceMenuRows() {
      return referenceRows(this.references, this.t);
    },
    commandMenuRows() {
      return visibleCommands(this.commands, this.draft, this.commandTyped);
    },
    overlayPointerActive() {
      return this.referenceOpen || this.commandsOpen;
    },
  },
  watch: {
    draft() {
      this.autosize();
    },
    overlayPointerActive(active) {
      if (active) window.addEventListener("pointerdown", this.onTokenPointer, true);
      else window.removeEventListener("pointerdown", this.onTokenPointer, true);
    },
  },
  mounted() {
    this.autosize();
  },
  beforeUnmount() {
    this.clearHold();
    window.clearTimeout(this.referenceTimer);
    window.removeEventListener("pointerdown", this.onTokenPointer, true);
  },
  methods: {
    onInput(event) {
      const value = event.target.value;
      this.$emit("update:draft", value);
      this.trackReference(value, event.target.selectionStart ?? value.length);
      if (isCommandLine(value)) {
        if (!this.commandsOpen) this.$emit("open-commands");
        this.commandTyped = true;
        this.commandIndex = 0;
        this.commandsOpen = true;
      } else if (this.commandTyped) {
        this.commandTyped = false;
        this.commandsOpen = false;
      }
    },
    onCaretMove(event) {
      window.setTimeout(() => {
        if (this.referenceOpen) {
          this.trackReference(this.draft, event.target.selectionStart ?? this.draft.length);
        }
      }, 0);
    },
    onTokenPointer(event) {
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
        if (this.referenceOpen) {
          this.trackReference(this.draft, input.selectionStart ?? this.draft.length);
        }
      }, 0);
    },
    closeReferences() {
      window.clearTimeout(this.referenceTimer);
      this.referenceOpen = false;
      this.referenceToken = null;
    },
    trackReference(value, caret) {
      const token = activeReference(value, caret);
      window.clearTimeout(this.referenceTimer);
      if (!token) {
        this.closeReferences();
        return;
      }
      this.commandsOpen = false;
      this.commandTyped = false;
      this.referenceOpen = true;
      this.referenceToken = token;
      this.referenceIndex = 0;
      this.referenceTimer = window.setTimeout(() => {
        this.$emit("open-references", { query: token.query, quoted: token.quoted });
      }, REFERENCE_DEBOUNCE_MS);
    },
    pickReference(row) {
      if (!this.referenceToken) return;
      const inserted = applyReference(this.draft, this.referenceToken, row);
      this.$emit("update:draft", inserted.draft);
      this.$nextTick(() => {
        const input = this.$refs.input;
        input?.focus();
        input?.setSelectionRange(inserted.caret, inserted.caret);
        if (row.continuation) this.trackReference(inserted.draft, inserted.caret);
        else this.closeReferences();
      });
    },
    pickCommand(command) {
      this.commandsOpen = false;
      this.commandTyped = false;
      this.$emit("pick-command", command);
    },
    imageStatus(image) {
      return draftImageStatus(image);
    },
    onSend() {
      if (this.referenceOpen || this.commandsOpen) return;
      if (this.canSend) this.$emit("send");
    },
    onKeydown(event) {
      if (this.referenceOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          this.closeReferences();
          return;
        }
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && this.references.length) {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          this.referenceIndex = (this.referenceIndex + step + this.references.length) % this.references.length;
          return;
        }
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing && this.references.length) {
          event.preventDefault();
          this.pickReference(this.references[this.referenceIndex] ?? this.references[0]);
          return;
        }
      }
      if (this.commandsOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          this.commandsOpen = false;
          this.commandTyped = false;
          return;
        }
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && this.commandMenuRows.length) {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          this.commandIndex = (this.commandIndex + step + this.commandMenuRows.length) % this.commandMenuRows.length;
          return;
        }
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing && this.commandMenuRows.length) {
          event.preventDefault();
          this.pickCommand(this.commandMenuRows[this.commandIndex] ?? this.commandMenuRows[0]);
          return;
        }
      }
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) return;
      event.preventDefault();
      this.onSend();
    },
    canHold(event) {
      // Voice input parked (hold-to-record).
      return false;
      if (this.draft.trim() || this.sending || this.voiceBlocked) return false;
      if (event.pointerType === "mouse") return false;
      return true;
    },
    onContextMenu(event) {
      if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) {
        event.preventDefault();
      }
    },
    onHoldDown(event) {
      if (!this.canHold(event)) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      this.holdTimer = window.setTimeout(() => {
        this.holding = true;
        this.$refs.input?.blur();
        this.$emit("hold-start");
      }, HOLD_MS);
    },
    onHoldUp(event) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      this.clearHold(true);
    },
    clearHold(emitEnd = false) {
      if (this.holdTimer) {
        clearTimeout(this.holdTimer);
        this.holdTimer = 0;
      }
      if (this.holding) {
        this.holding = false;
        if (emitEnd) this.$emit("hold-end");
      }
    },
    pickFiles() {
      this.$refs.picker?.click();
    },
    onFiles(event) {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = "";
      if (files.length) this.$emit("files", files);
    },
    autosize() {
      this.$nextTick(() => {
        const el = this.$refs.input;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
      });
    },
    focus() {
      this.$refs.input?.focus();
    },
  },
};
</script>

<style scoped>
.lares-composer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
  padding: 8px 16px calc(12px + env(safe-area-inset-bottom, 0px));
}

.lares-composer--hero {
  padding: 0;
}

.lares-composer__card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--q-input-stroke);
  border-radius: 24px;
  padding: 12px 14px 10px;
  background: var(--q-background-1);
}

.lares-composer__menu {
  position: absolute;
  z-index: 12;
  right: 0;
  bottom: calc(100% + 6px);
  left: 0;
  display: flex;
  max-height: min(240px, 38vh);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--q-separator);
  border-radius: 14px;
  padding: 4px;
  background: var(--q-background-1);
  box-shadow: 0 12px 30px rgb(0 0 0 / 16%);
}

.lares-composer__menu-scroll {
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.lares-composer__menu-status {
  display: flex;
  min-height: 40px;
  align-items: center;
  margin: 0;
  padding: 8px 12px;
  color: var(--q-ink-3);
  font-size: 15px;
  line-height: 20px;
}

.lares-composer__menu-section {
  margin: 0;
  padding: 6px 12px 2px;
  color: var(--q-ink-3);
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
}

.lares-composer__menu-section:not(:first-child) {
  margin-top: 4px;
}

.lares-composer__menu-item {
  display: flex;
  width: 100%;
  min-height: 44px;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 10px;
  padding: 8px 12px;
  background: transparent;
  color: var(--q-ink-1);
  font: inherit;
  font-size: 15px;
  line-height: 20px;
  text-align: left;
}

.lares-composer__menu-item[data-selected="true"],
.lares-composer__menu-item:active {
  background: var(--q-background-hover);
}

.lares-composer__menu-name {
  max-width: 42%;
  flex: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lares-composer__menu-path {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--q-ink-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lares-composer__menu-item--command {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.lares-composer__command-name {
  color: var(--q-ink-1);
  font-weight: 500;
}

.lares-composer__command-hint {
  width: 100%;
  overflow: hidden;
  color: var(--q-ink-3);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lares-composer__card[data-hero="true"] {
  gap: 4px;
  border-radius: 20px;
  padding: 10px 14px 8px;
  background: var(--q-background-2);
}

.lares-composer__card[data-hero="true"] .lares-composer__input {
  min-height: 44px;
  padding: 0;
  font-size: 16px;
  line-height: 1.45;
}

.lares-composer__card[data-hero="true"] .lares-composer__bar {
  min-height: 28px;
}

.lares-composer__attachments {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 0 0 4px;
  scrollbar-width: none;
}

.lares-composer__attachments::-webkit-scrollbar {
  display: none;
}

.lares-composer__attachments figure {
  position: relative;
  width: 72px;
  height: 72px;
  flex: 0 0 72px;
  overflow: hidden;
  margin: 0;
  border: 1px solid var(--q-separator);
  border-radius: 12px;
  background: var(--q-background-3);
}

.lares-composer__attachments figure[data-status="failed"] {
  border-color: var(--q-orange-default);
}

.lares-composer__attachment-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: opacity var(--lares-duration-normal, 220ms) var(--lares-ease-out, ease);
}

.lares-composer__attachment-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 42%);
  color: var(--q-ink-on-brand);
}

.lares-composer__attachment-overlay[data-kind="error"] {
  background: rgb(0 0 0 / 54%);
  font-size: 18px;
  font-weight: 700;
}

.lares-composer__attachment-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border: 0;
  border-radius: 50%;
  padding: 0;
  background: rgb(0 0 0 / 58%);
  color: white;
}

.lares-composer__attachment-remove svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

.lares-composer__input {
  width: 100%;
  min-height: 28px;
  max-height: 176px;
  resize: none;
  overflow-y: auto;
  border: 0;
  padding: 2px 2px 4px;
  background: transparent;
  line-height: 1.45;
}

.lares-composer__input:focus {
  outline: none;
}

.lares-composer__hold {
  margin: 0;
  color: var(--q-blue-default);
  font-size: 15px;
  line-height: 20px;
}

.lares-composer__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
}

.lares-composer__pills {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.lares-composer__pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  width: 98px;
  flex: 0 0 98px;
  height: 32px;
  border: 0;
  border-radius: 999px;
  padding: 0 10px 0 8px;
  background: var(--q-background-3);
  color: var(--q-ink-2);
  font-size: 15px;
  font-weight: 500;
  line-height: 18px;
  white-space: nowrap;
}

.lares-composer__pill span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lares-composer__pill svg {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.lares-composer__pill svg .lares-composer__nucleus {
  fill: currentColor;
}

.lares-composer__tools {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-left: auto;
  flex-shrink: 0;
}

.lares-composer__picker {
  display: none;
}

.lares-composer__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1.5px solid currentColor;
  border-radius: 999px;
  padding: 0;
  background: transparent;
  color: var(--q-ink-1);
}

.lares-composer__icon:active {
  background: var(--q-btn-bg-pressed);
}

.lares-composer__icon[data-kind="send"],
.lares-composer__icon[data-kind="voice"] {
  border-color: transparent;
  color: var(--q-ink-on-brand);
}

.lares-composer__icon[data-kind="send"] {
  background: var(--q-blue-default);
}

.lares-composer__icon[data-kind="voice"] {
  background: var(--q-ink-1);
}

.lares-composer__icon svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.lares-composer__icon svg.lares-composer__wave {
  width: 18px;
  height: 18px;
  stroke-width: 2.75;
}

.lares-composer__live {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.lares-composer__spin {
  animation: lares-composer-spin 0.8s linear infinite;
}

.lares-composer__spin circle {
  fill: none;
  stroke-dasharray: 24 12;
}

.lares-composer__hint {
  margin: 0 4px;
  font-size: 14px;
  color: var(--q-ink-3);
}

.lares-composer__hint[data-status="error"] {
  color: var(--q-orange-default);
}

@keyframes lares-composer-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .lares-composer__spin {
    animation: none;
  }
}
</style>
