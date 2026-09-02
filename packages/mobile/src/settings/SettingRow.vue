<template>
  <button
    type="button"
    class="lares-set-row"
    :class="{ 'lares-set-row--boxed': boxed }"
    :disabled="disabled"
    @click="$emit('click')"
  >
    <span class="lares-set-row__label">{{ label }}</span>
    <span class="lares-set-row__side">
      <span v-if="value" class="lares-set-row__value">{{ value }}</span>
      <svg v-if="chevron" class="lares-set-row__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 6.5 15.5 12 9 17.5" />
      </svg>
      <svg
        v-else-if="checked"
        class="lares-set-row__icon lares-set-row__icon--check"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M5 12.5 9.5 17 19 7.5" />
      </svg>
    </span>
  </button>
</template>

<script>
export default {
  name: "LaresSettingRow",
  props: {
    label: { type: String, required: true },
    value: { type: String, default: "" },
    chevron: { type: Boolean, default: false },
    checked: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    boxed: { type: Boolean, default: false },
  },
  emits: ["click"],
};
</script>

<style scoped>
.lares-set-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 56px;
  border: 0;
  padding: 12px 16px;
  background: transparent;
  color: var(--q-ink-1);
  text-align: left;
}

.lares-set-row--boxed {
  min-height: 64px;
  border: 1px solid var(--q-separator);
  border-radius: 20px;
}

.lares-set-row:disabled {
  opacity: 0.5;
}

.lares-set-row:not(.lares-set-row--boxed) + .lares-set-row:not(.lares-set-row--boxed) {
  border-top: 1px solid var(--q-separator);
}

.lares-set-row:active:not(:disabled) {
  background: var(--q-background-hover);
}

.lares-set-row__label {
  min-width: 0;
  flex: 1;
  font-size: 14px;
  line-height: 20px;
  word-break: break-word;
}

.lares-set-row__side {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  max-width: 52%;
}

.lares-set-row__value {
  overflow: hidden;
  font-size: 13px;
  line-height: 18px;
  color: var(--q-ink-2);
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lares-set-row__icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  fill: none;
  stroke: var(--q-ink-3);
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.lares-set-row__icon--check {
  stroke: var(--q-blue-default);
}
</style>
