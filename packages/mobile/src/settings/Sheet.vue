<template>
  <Teleport to="body">
    <div
      class="lares-sheet"
      :data-open="open ? 'true' : 'false'"
      :inert="!open"
      :aria-hidden="!open"
    >
      <div class="lares-sheet__backdrop" @click="$emit('close')" />
      <div class="lares-sheet__panel" role="dialog" :aria-label="title">
        <header class="lares-sheet__head">
          <h2 class="lares-sheet__title">{{ title }}</h2>
          <button type="button" class="lares-sheet__close" @click="$emit('close')">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <div class="lares-sheet__body">
          <slot />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script>
export default {
  name: "LaresSheet",
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, default: "" },
  },
  emits: ["close"],
};
</script>

<style scoped>
.lares-sheet {
  position: fixed;
  inset: 0;
  z-index: 40;
  pointer-events: none;
}

.lares-sheet[data-open="true"] {
  pointer-events: auto;
}

.lares-sheet__backdrop {
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / 32%);
  opacity: 0;
  transition: opacity 0.28s cubic-bezier(0.32, 0.72, 0, 1);
}

.lares-sheet[data-open="true"] .lares-sheet__backdrop {
  opacity: 1;
}

.lares-sheet__panel {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  max-height: min(70vh, 560px);
  flex-direction: column;
  min-height: 0;
  border-radius: 12px 12px 0 0;
  border-top: 1px solid var(--q-separator);
  background: var(--q-background-1);
  box-shadow: 0 -8px 32px rgb(0 0 0 / 12%);
  transform: translateY(100%);
  transition: transform 0.28s cubic-bezier(0.32, 0.72, 0, 1);
}

.lares-sheet[data-open="true"] .lares-sheet__panel {
  transform: translateY(0);
}

.lares-sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  height: 64px;
  padding: 0 8px 0 20px;
}

.lares-sheet__title {
  margin: 0;
  font-size: 18px;
  font-weight: 500;
  line-height: 24px;
}

.lares-sheet__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 0;
  background: transparent;
  color: var(--q-ink-2);
}

.lares-sheet__close svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
}

.lares-sheet__body {
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0 0 calc(12px + env(safe-area-inset-bottom, 0px));
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

@media (prefers-reduced-motion: reduce) {
  .lares-sheet__backdrop,
  .lares-sheet__panel {
    transition: none;
  }
}
</style>
