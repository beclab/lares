<template>
  <header class="lares-bar">
    <button
      type="button"
      class="lares-bar__icon-btn"
      :data-unseen="unseen ? 'true' : 'false'"
      :aria-label="t('bar.menu')"
      @click="$emit('history')"
    >
      <svg class="lares-bar__glyph" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 6.5h14M5 12h14M5 17.5h14" />
      </svg>
      <span v-if="unseen" class="lares-bar__dot" aria-hidden="true" />
    </button>
    <div class="lares-bar__switch" role="group" :aria-label="t('model.menuAria')">
      <button
        type="button"
        class="lares-bar__segment"
        :disabled="modelBusy"
        :aria-label="modelAria"
        @click="$emit('model')"
      >
        <span>{{ modelLabel || t("model.select") }}</span>
      </button>
      <button
        v-if="!effortDisabled"
        type="button"
        class="lares-bar__segment"
        :disabled="modelBusy"
        :aria-label="effortAria"
        @click="$emit('model')"
      >
        <span>{{ effortLabel || t("reasoning.default") }}</span>
      </button>
    </div>
    <button
      type="button"
      class="lares-bar__icon-btn"
      :data-speak="speak ? 'true' : 'false'"
      :disabled="speakBusy"
      :aria-pressed="speak"
      :aria-label="speak ? t('bar.speakOn') : t('bar.speakOff')"
      @click="$emit('speak')"
    >
      <svg v-if="speak" class="lares-bar__glyph" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 10h3.2L11 6.5v11L7.2 14H4z" />
        <path d="M14.5 9.2a3.2 3.2 0 0 1 0 5.6" />
        <path d="M16.8 7a6 6 0 0 1 0 10" />
      </svg>
      <svg v-else class="lares-bar__glyph" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 10h3.2L11 6.5v11L7.2 14H4z" />
        <path d="m16 10 4 4M20 10l-4 4" />
      </svg>
    </button>
  </header>
</template>

<script>
export default {
  name: "LaresChatBar",
  props: {
    t: { type: Function, required: true },
    modelLabel: { type: String, default: "" },
    modelBusy: { type: Boolean, default: false },
    effortLabel: { type: String, default: "" },
    effortDisabled: { type: Boolean, default: false },
    unseen: { type: Boolean, default: false },
    speak: { type: Boolean, default: false },
    speakBusy: { type: Boolean, default: false },
  },
  emits: ["history", "model", "effort", "speak"],
  computed: {
    modelAria() {
      return this.modelLabel
        ? this.t("model.switchAria", { label: this.modelLabel })
        : this.t("model.select");
    },
    effortAria() {
      return this.t("reasoning.switchAria", { label: this.effortLabel || this.t("reasoning.default") });
    },
  },
};
</script>

<style scoped>
.lares-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  min-height: 56px;
  padding: calc(8px + env(safe-area-inset-top, 0px)) 12px 8px;
}

.lares-bar__icon-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border: 1px solid var(--q-separator);
  border-radius: 999px;
  padding: 0;
  background: var(--q-background-1);
  color: var(--q-ink-1);
}

.lares-bar__glyph {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.lares-bar__icon-btn[data-speak="true"] {
  color: var(--q-blue-default);
  border-color: var(--q-blue-default);
}

.lares-bar__icon-btn:active:not(:disabled) {
  background: var(--q-btn-bg-pressed);
}

.lares-bar__dot {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--q-blue-default);
  box-shadow: 0 0 0 2px var(--q-background-1);
}

.lares-bar__switch {
  display: inline-flex;
  min-width: 0;
  max-width: calc(100% - 96px);
  height: 36px;
  margin-right: auto;
  overflow: hidden;
  align-items: stretch;
  border-radius: 999px;
  background: var(--q-background-3);
}

.lares-bar__segment {
  display: inline-flex;
  min-width: 0;
  max-width: 148px;
  align-items: center;
  border: 0;
  padding: 0 14px;
  background: transparent;
  color: var(--q-ink-1);
  font-size: 15px;
  font-weight: 600;
  line-height: 20px;
}

.lares-bar__segment + .lares-bar__segment::before {
  content: "";
  width: 1px;
  height: 14px;
  flex: none;
  margin-right: 12px;
  background: var(--q-separator);
}

.lares-bar__segment span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lares-bar__segment:active:not(:disabled) {
  background: var(--q-btn-bg-pressed);
}
</style>
