<template>
  <header class="lares-bar">
    <button type="button" class="lares-bar__icon-btn" :aria-label="t('bar.menu')" @click="$emit('history')">
      <svg class="lares-bar__glyph" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 9h14M5 15h14" />
      </svg>
    </button>
    <h1 class="lares-bar__title">{{ title }}</h1>
    <button
      type="button"
      class="lares-bar__icon-btn"
      :disabled="starting"
      :aria-label="t('bar.newAria')"
      @click="$emit('create')"
    >
      <svg class="lares-bar__glyph" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.25" />
        <path d="M12 8.5v7M8.5 12h7" />
      </svg>
    </button>
  </header>
</template>

<script>
export default {
  name: "LaresChatBar",
  props: {
    t: { type: Function, required: true },
    title: { type: String, default: "" },
    starting: { type: Boolean, default: false },
  },
  emits: ["history", "create"],
};
</script>

<style scoped>
.lares-bar {
  display: grid;
  grid-template-columns: 44px 1fr 44px;
  align-items: center;
  flex-shrink: 0;
  min-height: 56px;
  padding: 6px 8px;
}

.lares-bar__title {
  max-width: 100%;
  margin: 0;
  overflow: hidden;
  font-size: 16px;
  font-weight: 600;
  line-height: 22px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lares-bar__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 999px;
  padding: 0;
  background: transparent;
  color: var(--q-ink-1);
}

.lares-bar__glyph {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.lares-bar__icon-btn:active {
  background: var(--q-btn-bg-pressed);
}
</style>
