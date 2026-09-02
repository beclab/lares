<template>
  <form class="lares-composer" @submit.prevent="onSend">
    <div class="lares-composer__card" data-composer-card :data-holding="holding ? 'true' : 'false'">
      <textarea
        ref="input"
        :value="draft"
        class="lares-composer__input"
        rows="1"
        :placeholder="t('chat.placeholder')"
        :disabled="sending"
        @input="onInput"
        @keydown="onKeydown"
        @pointerdown="onHoldDown"
        @pointerup="onHoldUp"
        @pointercancel="onHoldUp"
        @contextmenu="onContextMenu"
      />
      <p v-if="holding" class="lares-composer__hold">{{ t("composer.hold") }} · {{ elapsed }}</p>
      <div class="lares-composer__bar">
        <div class="lares-composer__pills">
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
    t: { type: Function, required: true },
  },
  emits: ["update:draft", "send", "model", "effort", "files", "voice", "hold-start", "hold-end"],
  data() {
    return { holding: false, holdTimer: 0 };
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
    voiceLabel() {
      if (this.voiceError) return this.voiceError;
      if (this.voicePhase === "recording") return this.t("mic.stop");
      if (this.voicePhase === "transcribing") return this.t("mic.transcribing");
      return this.t("composer.voice");
    },
    voiceBlocked() {
      return this.voicePhase === "transcribing" || this.sending;
    },
  },
  watch: {
    draft() {
      this.autosize();
    },
  },
  mounted() {
    this.autosize();
  },
  beforeUnmount() {
    this.clearHold();
  },
  methods: {
    onInput(event) {
      this.$emit("update:draft", event.target.value);
    },
    onSend() {
      if (this.canSend) this.$emit("send");
    },
    onKeydown(event) {
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
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
      });
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

.lares-composer__card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--q-input-stroke);
  border-radius: 24px;
  padding: 12px 14px 10px;
  background: var(--q-background-1);
}

.lares-composer__input {
  width: 100%;
  min-height: 24px;
  max-height: 160px;
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
  font-size: 13px;
  line-height: 18px;
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
  font-size: 13px;
  font-weight: 500;
  line-height: 16px;
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
  font-size: 10px;
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
  font-size: 12px;
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
