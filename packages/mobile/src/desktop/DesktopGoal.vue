<template>
  <Transition name="lares-panel">
    <div v-if="goal" class="desktop-goal">
    <div class="desktop-goal__body">
      <input
        v-if="editing"
        ref="editor"
        v-model="objective"
        :aria-label="t('goal.edit')"
        @keydown.enter.exact.prevent="save"
        @keydown.esc="editing = false"
      />
      <template v-else>
        <span class="desktop-goal__mark" aria-hidden="true">◎</span>
        <span class="desktop-goal__text">{{ goal.objective }}</span>
        <span class="desktop-goal__round">{{ goal.roundsStarted || 0 }}/{{ goal.maxGoalRounds }}</span>
      </template>
    </div>
    <div class="desktop-goal__actions">
      <button v-if="editing" type="button" :disabled="busy || !objective.trim()" @click="save">✓</button>
      <button v-if="editing" type="button" :disabled="busy" @click="editing = false">×</button>
      <template v-else>
        <button type="button" :aria-label="t('goal.edit')" :disabled="busy" @click="beginEdit">✎</button>
        <button
          v-if="goal.phase === 'active'"
          type="button"
          :aria-label="t('goal.pause')"
          :disabled="busy"
          @click="$emit('action', 'pause')"
        >Ⅱ</button>
        <button
          v-else-if="goal.phase === 'paused'"
          type="button"
          :aria-label="t('goal.resume')"
          :disabled="busy"
          @click="$emit('action', 'resume')"
        >▶</button>
        <button type="button" :aria-label="t('goal.clear')" :disabled="busy" @click="$emit('action', 'clear')">×</button>
      </template>
    </div>
    </div>
  </Transition>
</template>

<script>
export default {
  name: "LaresDesktopGoal",
  props: {
    projection: { type: Object, default: null },
    busy: { type: Boolean, default: false },
    t: { type: Function, required: true },
  },
  emits: ["action"],
  data() {
    return { editing: false, objective: "" };
  },
  computed: {
    goal() {
      return this.projection?.goal ?? null;
    },
  },
  methods: {
    beginEdit() {
      this.objective = this.goal?.objective ?? "";
      this.editing = true;
      this.$nextTick(() => this.$refs.editor?.focus?.());
    },
    save() {
      if (!this.objective.trim()) return;
      this.$emit("action", "edit", this.objective.trim());
      this.editing = false;
    },
  },
};
</script>

<style scoped>
.desktop-goal { display:flex; box-sizing:border-box; width:calc(100% - 24px); min-height:40px; align-items:center; gap:8px; margin:0 auto -3px; border:1px solid var(--q-separator); border-bottom:0; border-radius:12px 12px 0 0; padding:5px 8px 7px 12px; background:var(--q-background-3); }
.desktop-goal__body { display:flex; min-width:0; flex:1; align-items:center; gap:8px; }
.desktop-goal__mark { color:var(--q-blue-default); }
.desktop-goal__text { overflow:hidden; flex:1; color:var(--q-ink-2); font-size:13px; text-overflow:ellipsis; white-space:nowrap; }
.desktop-goal__round { color:var(--q-ink-3); font-size:11px; }
.desktop-goal input { box-sizing:border-box; width:100%; height:28px; border:1px solid var(--q-input-stroke); border-radius:6px; padding:0 8px; outline:none; background:var(--q-background-1); color:var(--q-ink-1); }
.desktop-goal__actions { display:flex; gap:3px; }
.desktop-goal button { display:grid; width:27px; height:27px; place-items:center; border:0; border-radius:50%; background:transparent; color:var(--q-ink-3); cursor:pointer; }
.desktop-goal button:hover:not(:disabled) { background:var(--q-background-hover); color:var(--q-ink-2); }
.desktop-goal button:disabled { opacity:.45; cursor:default; }
</style>
