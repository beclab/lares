<template>
  <div
    class="lares-history"
    :data-open="open ? 'true' : 'false'"
    :inert="!open"
    :aria-hidden="!open"
  >
    <div class="lares-history__backdrop" @click="$emit('close')" />
    <aside class="lares-history__sheet" role="dialog" :aria-label="t('bar.history')">
      <header class="lares-history__head">
        <h2 class="lares-history__title">{{ t("bar.history") }}</h2>
      </header>
      <div class="lares-history__list">
        <div
          v-if="pending"
          class="lares-history__skeleton"
          role="status"
          :aria-label="t('history.loading')"
        >
          <section v-for="block in [1, 2]" :key="block" class="lares-history__section">
            <span class="lares-history__bone lares-history__bone--label" />
            <span class="lares-history__bone" />
            <span class="lares-history__bone" />
            <span class="lares-history__bone" />
            <span class="lares-history__bone" />
          </section>
        </div>
        <p v-else-if="sections.length === 0" class="lares-history__empty">{{ t("history.empty") }}</p>
        <section v-for="section in sections" :key="section.id" class="lares-history__section">
          <h3 class="lares-history__label">{{ t(section.key) }}</h3>
          <button
            v-for="row in section.rows"
            :key="row.sessionId"
            type="button"
            class="lares-history__item"
            :data-current="row.sessionId === sessionId ? 'true' : 'false'"
            @click="$emit('pick', row.sessionId)"
          >
            {{ row.title || t("history.untitled") }}
          </button>
        </section>
      </div>
    </aside>
  </div>
</template>

<script>
import { groupSessionsByRecency, visibleHistorySessions } from "@lares/core/larepass/chat";

export default {
  name: "LaresHistoryPanel",
  props: {
    open: { type: Boolean, default: false },
    sessions: { type: Array, default: () => [] },
    sessionId: { type: String, default: "" },
    ready: { type: Boolean, default: false },
    t: { type: Function, required: true },
  },
  emits: ["close", "pick"],
  computed: {
    pending() {
      return !this.ready && this.sections.length === 0;
    },
    sections() {
      return groupSessionsByRecency(visibleHistorySessions(this.sessions, this.sessionId));
    },
  },
};
</script>

<style scoped>
.lares-history {
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
}

.lares-history[data-open="true"] {
  pointer-events: auto;
}

.lares-history__backdrop {
  position: absolute;
  inset: 0;
  background: var(--q-background-alpha);
  opacity: 0;
  transition: opacity 0.28s cubic-bezier(0.32, 0.72, 0, 1);
}

.lares-history[data-open="true"] .lares-history__backdrop {
  opacity: 1;
}

.lares-history__sheet {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  display: flex;
  width: min(80vw, 320px);
  height: 100%;
  flex-direction: column;
  min-height: 0;
  background: var(--q-background-1);
  box-shadow: 8px 0 32px rgb(0 0 0 / 8%);
  transform: translateX(-100%);
  transition: transform 0.28s cubic-bezier(0.32, 0.72, 0, 1);
}

.lares-history[data-open="true"] .lares-history__sheet {
  transform: translateX(0);
}

.lares-history__head {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  height: 56px;
  padding: 0 20px;
}

.lares-history__title {
  margin: 0;
  font-size: 18px;
  font-weight: 500;
  line-height: 24px;
}

.lares-history__list {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 16px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 4px 12px 24px;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.lares-history__section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.lares-history__label {
  margin: 0;
  padding: 8px 16px 4px;
  color: var(--q-ink-3);
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
}

.lares-history__empty {
  margin: 12px 8px;
  font-size: 13px;
  color: var(--q-ink-3);
}

.lares-history__skeleton {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.lares-history__bone {
  display: block;
  height: 44px;
  border-radius: 12px;
  background: var(--q-background-3);
  animation: lares-history-pulse 1.2s ease-in-out infinite;
}

.lares-history__bone--label {
  width: 72px;
  height: 12px;
  margin: 8px 16px 4px;
  border-radius: 6px;
}

.lares-history__section .lares-history__bone:nth-child(2) { width: 88%; }
.lares-history__section .lares-history__bone:nth-child(3) { width: 72%; }
.lares-history__section .lares-history__bone:nth-child(4) { width: 80%; }
.lares-history__section .lares-history__bone:nth-child(5) { width: 64%; }

@keyframes lares-history-pulse {
  50% { opacity: 0.45; }
}

@media (prefers-reduced-motion: reduce) {
  .lares-history__bone {
    animation: none;
  }
}

.lares-history__item {
  width: 100%;
  overflow: hidden;
  border: 0;
  border-radius: 12px;
  padding: 12px 16px;
  text-align: left;
  background: transparent;
  color: var(--q-ink-1);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lares-history__item[data-current="true"] {
  background: var(--q-background-3);
}

.lares-history__item:active {
  background: var(--q-background-hover);
}

@media (prefers-reduced-motion: reduce) {
  .lares-history__backdrop,
  .lares-history__sheet {
    transition: none;
  }
}
</style>
