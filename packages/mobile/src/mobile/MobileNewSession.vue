<template>
  <section class="mobile-new-session" :aria-label="t('desktop.newSession')">
    <div class="mobile-new-session__brand">
      <div class="mobile-new-session__logo" :style="logoStyle" aria-hidden="true" />
      <h2 class="mobile-new-session__title">{{ t("shell.title") }}</h2>
    </div>

    <div class="mobile-new-session__prompt">
      <div class="mobile-new-session__selectors">
        <button
          type="button"
          class="mobile-new-session__chip mobile-new-session__chip--workspace"
          :disabled="workspaceBusy"
          :aria-label="t('desktop.workspaces')"
          @click="$emit('workspace')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3.5 7.5h6l1.6 2H20.5v9H3.5z" />
          </svg>
          <span>{{ workspaceLabel }}</span>
          <svg class="mobile-new-session__chevron" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 10l5 5 5-5" />
          </svg>
        </button>
        <button
          type="button"
          class="mobile-new-session__chip mobile-new-session__chip--model"
          :disabled="modelBusy"
          :aria-label="modelAria"
          @click="$emit('model')"
        >
          <span>{{ modelLabel || t("model.select") }}</span>
          <svg class="mobile-new-session__chevron" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 10l5 5 5-5" />
          </svg>
        </button>
      </div>
      <div class="mobile-new-session__composer">
        <slot />
      </div>
    </div>
  </section>
</template>

<script>
import { MARK_DATA_URI } from "@olares/lares-core/icons/mark";

export default {
  name: "LaresMobileNewSession",
  props: {
    t: { type: Function, required: true },
    workspaceLabel: { type: String, default: "" },
    workspaceBusy: { type: Boolean, default: false },
    modelLabel: { type: String, default: "" },
    modelBusy: { type: Boolean, default: false },
  },
  emits: ["workspace", "model"],
  computed: {
    logoStyle() {
      return { backgroundImage: MARK_DATA_URI };
    },
    modelAria() {
      return this.modelLabel
        ? this.t("model.switchAria", { label: this.modelLabel })
        : this.t("model.select");
    },
  },
};
</script>

<style scoped>
.mobile-new-session {
  display: flex;
  width: 100%;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px 20px calc(12px + env(safe-area-inset-bottom, 0px));
}

.mobile-new-session__brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-bottom: 32px;
}

.mobile-new-session__logo {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  box-shadow: inset 0 1.8px 0 rgb(255 255 255 / 50%);
  animation: mobile-brand-in var(--lares-duration-normal, 220ms) var(--lares-ease-out, cubic-bezier(0.32, 0.72, 0, 1));
}

@keyframes mobile-brand-in {
  from {
    opacity: 0;
    transform: scale(0.92);
  }
}

@media (prefers-reduced-motion: reduce) {
  .mobile-new-session__logo {
    animation: none;
  }
}

.mobile-new-session__title {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  line-height: 34px;
  letter-spacing: -0.02em;
}

.mobile-new-session__prompt {
  display: flex;
  width: min(100%, 420px);
  flex-direction: column;
  gap: 6px;
}

.mobile-new-session__selectors {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.mobile-new-session__chip {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  border: 0;
  border-radius: 999px;
  padding: 6px 10px;
  background: transparent;
  color: var(--q-ink-2);
  font-size: 14px;
  font-weight: 500;
  line-height: 18px;
  transition: background var(--lares-duration-fast, 120ms) var(--lares-ease-out, ease),
    color var(--lares-duration-fast, 120ms) var(--lares-ease-out, ease);
}

.mobile-new-session__chip--workspace {
  flex: 0 1 auto;
  max-width: 46%;
}

.mobile-new-session__chip--model {
  flex: 1 1 auto;
  justify-content: flex-end;
  max-width: 54%;
}

.mobile-new-session__chip span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobile-new-session__chip svg:not(.mobile-new-session__chevron) {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linejoin: round;
}

.mobile-new-session__chevron {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.mobile-new-session__chip:active:not(:disabled) {
  background: var(--q-btn-bg-pressed);
}

.mobile-new-session__composer {
  width: 100%;
}

@media (max-height: 640px) {
  .mobile-new-session__brand {
    margin-bottom: 24px;
  }

  .mobile-new-session__logo {
    width: 48px;
    height: 48px;
  }

  .mobile-new-session__title {
    font-size: 24px;
    line-height: 30px;
  }
}
</style>
