<template>
  <div class="lares-actions" role="toolbar" :aria-label="t('action.bar')">
    <div class="lares-actions__left">
      <button type="button" :aria-label="copied ? t('action.copied') : t('action.copy')" @click="copy">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="9" width="11" height="13" rx="2" />
          <path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
      <button
        type="button"
        :aria-label="t('action.like')"
        :aria-pressed="reaction === 'like' ? 'true' : 'false'"
        :data-on="reaction === 'like' ? 'true' : 'false'"
        @click="$emit('react', reaction === 'like' ? '' : 'like')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 11v10H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h3Zm0 0 4.2-8.1A2.2 2.2 0 0 1 15.2 4v5H20a2 2 0 0 1 2 2.3l-1.2 8A2 2 0 0 1 18.8 21H7" />
        </svg>
      </button>
      <button
        type="button"
        :aria-label="t('action.dislike')"
        :aria-pressed="reaction === 'dislike' ? 'true' : 'false'"
        :data-on="reaction === 'dislike' ? 'true' : 'false'"
        @click="$emit('react', reaction === 'dislike' ? '' : 'dislike')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M17 13V3h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-3Zm0 0-4.2 8.1A2.2 2.2 0 0 1 8.8 20v-5H4a2 2 0 0 1-2-2.3l1.2-8A2 2 0 0 1 5.2 3H17" />
        </svg>
      </button>
      <button type="button" :aria-label="t('action.share')" @click="share">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
          <path d="m16 5 4 4-4 4" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script>
export default {
  name: "LaresMessageActions",
  props: {
    text: { type: String, default: "" },
    reaction: { type: String, default: "" },
    t: { type: Function, required: true },
  },
  emits: ["react"],
  data() {
    return { copied: false, copyTimer: 0 };
  },
  beforeUnmount() {
    if (this.copyTimer) clearTimeout(this.copyTimer);
  },
  methods: {
    async copy() {
      try {
        await navigator.clipboard.writeText(this.text);
        this.copied = true;
        if (this.copyTimer) clearTimeout(this.copyTimer);
        this.copyTimer = setTimeout(() => {
          this.copied = false;
        }, 1600);
      } catch {
        // clipboard may be blocked
      }
    },
    async share() {
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ text: this.text });
          return;
        } catch (err) {
          if (err?.name === "AbortError") return;
        }
      }
      await this.copy();
    },
  },
};
</script>

<style scoped>
.lares-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}

.lares-actions__left {
  display: flex;
  align-items: center;
  gap: 2px;
}

.lares-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  padding: 0;
  background: transparent;
  color: var(--q-ink-3);
}

.lares-actions button[data-on="true"] {
  color: var(--q-blue-default);
}

.lares-actions button:active {
  background: var(--q-btn-bg-pressed);
}

.lares-actions svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
