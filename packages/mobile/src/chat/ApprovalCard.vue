<template>
  <section
    class="lares-approval"
    :aria-busy="busy ? 'true' : 'false'"
    @keydown="onKeydown"
  >
    <div class="lares-approval__strip">
      <span aria-hidden="true" />
      {{ t("approval.waiting") }}
    </div>
    <div
      class="lares-approval__body"
      tabindex="0"
      role="group"
      :aria-label="t('approval.detail')"
    >
      <p class="lares-approval__headline">{{ headline }}</p>
      <p v-if="approval.command" class="lares-approval__command">{{ approval.command }}</p>
    </div>
    <div class="lares-approval__actions">
      <button type="button" :disabled="busy" @click="$emit('answer', 'rejected')">
        {{ t("approval.reject") }}
      </button>
      <button type="button" :disabled="busy" @click="$emit('answer', 'allowed-once')">
        {{ t("approval.allowOnce") }}
      </button>
    </div>
  </section>
</template>

<script>
export default {
  name: "LaresApprovalCard",
  props: {
    approval: { type: Object, required: true },
    busy: { type: Boolean, default: false },
    t: { type: Function, required: true },
  },
  emits: ["answer"],
  computed: {
    headline() {
      return this.approval.reason || this.t("approval.escalation", { toolName: this.approval.toolName });
    },
  },
  methods: {
    onKeydown(event) {
      const target = event.target;
      if (event.defaultPrevented || this.busy) return;
      if (event.key !== "Enter" && event.key !== "Escape") return;
      if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "Enter" && target?.closest?.("button, a[href], [role='button']")) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat) return;
      event.preventDefault();
      this.$emit("answer", event.key === "Enter" ? "allowed-once" : "rejected");
    },
  },
};
</script>

<style scoped>
.lares-approval {
  overflow: hidden;
  border: 1px solid var(--q-orange-default);
  border-radius: 14px;
  background: var(--q-background-1);
  box-shadow: 0 1px 3px rgb(0 0 0 / 8%);
}

.lares-approval__strip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--q-orange-alpha);
  color: var(--q-orange-default);
  font-size: 13px;
  line-height: 18px;
}

.lares-approval__strip span {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--q-orange-default);
}

.lares-approval__body {
  display: flex;
  max-height: 160px;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  padding: 12px 16px 0;
}

.lares-approval__headline {
  margin: 0;
  color: var(--q-ink-1);
  font-size: 15px;
  font-weight: 500;
  line-height: 24px;
}

.lares-approval__command {
  margin: 0;
  color: var(--q-ink-3);
  font: 400 13px/20px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  word-break: break-all;
}

.lares-approval__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 16px;
}

.lares-approval__actions button {
  height: 32px;
  border: 1px solid var(--q-separator);
  border-radius: 7px;
  padding: 0 13px;
  background: transparent;
  color: var(--q-ink-2);
  font: inherit;
}

.lares-approval__actions button:last-child {
  border-color: transparent;
  background: var(--q-blue-default);
  color: var(--q-ink-on-brand);
}

.lares-approval__actions button:disabled {
  opacity: 0.45;
}
</style>
