<template>
  <section class="desktop-questions">
    <div class="desktop-questions__strip">{{ current.header || t("question.waiting") }}</div>
    <div class="desktop-questions__body">
      <strong>{{ current.question }}</strong>
      <p v-if="current.detail">{{ current.detail }}</p>
      <label v-for="option in current.options || []" :key="option.label" class="desktop-questions__option">
        <input
          :type="current.multiSelect ? 'checkbox' : 'radio'"
          :name="current.id"
          :value="option.label"
          :checked="selected(current.id).includes(option.label)"
          @change="toggle(option.label, $event.target.checked)"
        />
        <span><b>{{ option.label }}</b><small v-if="option.description">{{ option.description }}</small></span>
      </label>
      <label class="desktop-questions__other">
        <span>{{ t("question.other") }}</span>
        <input v-model="answers[current.id].custom" type="text" />
      </label>
    </div>
    <footer>
      <button v-if="index > 0" type="button" :disabled="busy" @click="index -= 1">{{ t("question.back") }}</button>
      <span />
      <button
        v-if="index < questions.length - 1"
        type="button"
        :disabled="!answered || busy"
        @click="index += 1"
      >{{ t("question.next") }}</button>
      <button v-else type="button" :disabled="!complete || busy" @click="submit">{{ t("question.submit") }}</button>
    </footer>
  </section>
</template>

<script>
function blankAnswers(questions) {
  return Object.fromEntries(questions.map((row) => [row.id, { selected: [], custom: "" }]));
}

export default {
  name: "LaresDesktopQuestions",
  props: {
    questions: { type: Array, required: true },
    busy: { type: Boolean, default: false },
    t: { type: Function, required: true },
  },
  emits: ["answer"],
  data() {
    return { index: 0, answers: blankAnswers(this.questions) };
  },
  computed: {
    current() {
      return this.questions[this.index] ?? {};
    },
    answered() {
      const row = this.answers[this.current.id];
      return Boolean(row && (row.selected.length || row.custom.trim()));
    },
    complete() {
      return this.questions.every((question) => {
        const row = this.answers[question.id];
        return Boolean(row && (row.selected.length || row.custom.trim()));
      });
    },
  },
  watch: {
    questions() {
      this.index = 0;
      this.answers = blankAnswers(this.questions);
    },
  },
  methods: {
    selected(id) {
      return this.answers[id]?.selected ?? [];
    },
    toggle(label, checked) {
      const id = this.current.id;
      const current = this.answers[id];
      current.selected = this.current.multiSelect
        ? (checked ? [...current.selected, label] : current.selected.filter((row) => row !== label))
        : (checked ? [label] : []);
    },
    submit() {
      if (!this.complete) return;
      this.$emit("answer", {
        answers: this.questions.map((question) => {
          const row = this.answers[question.id];
          return {
            id: question.id,
            selected: row.selected,
            ...(row.custom.trim() ? { custom: row.custom.trim() } : {}),
          };
        }),
      });
    },
  },
};
</script>

<style scoped>
.desktop-questions { overflow:hidden; border:1px solid var(--q-separator); border-radius:14px; background:var(--q-background-2); box-shadow:0 1px 3px rgb(0 0 0 / 8%); }
.desktop-questions__strip { height:30px; padding:0 12px; background:var(--q-background-3); color:var(--q-ink-3); font-size:12px; line-height:30px; }
.desktop-questions__body { display:flex; max-height:240px; flex-direction:column; gap:8px; overflow:auto; padding:14px 16px; color:var(--q-ink-2); font-size:13px; }
.desktop-questions__body > strong { color:var(--q-ink-1); font-size:14px; }
.desktop-questions__body > p { margin:0; white-space:pre-wrap; }
.desktop-questions__option { display:flex; gap:9px; border:1px solid var(--q-separator); border-radius:8px; padding:8px; cursor:pointer; }
.desktop-questions__option span { display:flex; flex-direction:column; gap:2px; }
.desktop-questions__option b { color:var(--q-ink-1); font-weight:500; }
.desktop-questions__option small { color:var(--q-ink-3); }
.desktop-questions__other { display:flex; align-items:center; gap:8px; }
.desktop-questions__other input { min-width:0; height:28px; flex:1; border:1px solid var(--q-input-stroke); border-radius:6px; padding:0 8px; background:var(--q-background-1); color:var(--q-ink-1); }
.desktop-questions footer { display:flex; align-items:center; gap:8px; padding:8px 12px 12px; }
.desktop-questions footer span { flex:1; }
.desktop-questions footer button { height:32px; border:1px solid var(--q-separator); border-radius:7px; padding:0 13px; background:transparent; color:var(--q-ink-2); font:inherit; cursor:pointer; }
.desktop-questions footer button:last-child { border-color:transparent; background:var(--q-blue-default); color:var(--q-ink-on-brand); }
.desktop-questions footer button:disabled { opacity:.45; cursor:default; }
</style>
