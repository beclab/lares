<template>
  <section class="lares-question" :aria-label="heading">
    <p class="lares-question__heading">{{ heading }}</p>
    <p class="lares-question__prompt">{{ prompt }}</p>
    <p v-if="detail" class="lares-question__detail">{{ detail }}</p>
    <div class="lares-question__options">
      <button
        v-for="option in options"
        :key="option.label"
        type="button"
        class="lares-question__option"
        :disabled="disabled"
        @click="$emit('pick', option.label)"
      >
        <span class="lares-question__label">{{ option.label }}</span>
        <span v-if="option.description" class="lares-question__hint">{{ option.description }}</span>
      </button>
    </div>
    <p v-if="hint" class="lares-question__wait">{{ hint }}</p>
  </section>
</template>

<script>
export default {
  name: "LaresQuestionCard",
  props: {
    questions: { type: Array, default: () => [] },
    rpcId: { type: String, default: "" },
    busy: { type: Boolean, default: false },
    t: { type: Function, required: true },
  },
  emits: ["pick"],
  computed: {
    current() {
      return this.questions[0] || null;
    },
    heading() {
      return this.current?.header || this.t("question.title");
    },
    prompt() {
      return this.current?.question || "";
    },
    detail() {
      return this.current?.detail || "";
    },
    options() {
      return Array.isArray(this.current?.options) ? this.current.options : [];
    },
    disabled() {
      return this.busy || !this.rpcId || !this.current;
    },
    hint() {
      if (this.busy) return this.t("question.busy");
      if (!this.rpcId) return this.t("question.waiting");
      return "";
    },
  },
};
</script>

<style scoped>
.lares-question {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
  margin: 8px 0;
  padding: 12px;
  border: 1px solid var(--q-separator);
  border-radius: 14px;
  background: var(--q-background-1);
}

.lares-question__heading {
  margin: 0;
  color: var(--q-ink-2);
  font-size: 12px;
}

.lares-question__prompt {
  margin: 0;
  color: var(--q-ink-1);
  font-size: 15px;
  font-weight: 500;
}

.lares-question__detail,
.lares-question__wait {
  margin: 0;
  color: var(--q-ink-3);
  font-size: 13px;
}

.lares-question__options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lares-question__option {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--q-separator);
  border-radius: 10px;
  background: var(--q-background-hover);
  color: inherit;
  text-align: left;
}

.lares-question__option:disabled {
  opacity: 0.55;
}

.lares-question__label {
  font-size: 14px;
  color: var(--q-ink-1);
}

.lares-question__hint {
  font-size: 12px;
  color: var(--q-ink-3);
}
</style>
