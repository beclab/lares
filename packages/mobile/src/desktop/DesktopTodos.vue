<template>
  <Transition name="lares-panel">
    <div v-if="rows.length" class="desktop-todos">
      <button type="button" class="desktop-todos__header" :aria-expanded="open" @click="open = !open">
        <span>{{ t("todo.progress", { done, total: rows.length }) }}</span>
        <span class="desktop-todos__chevron" :data-open="open ? 'true' : 'false'" aria-hidden="true">⌄</span>
      </button>
      <ul class="desktop-todos__list" :data-open="open ? 'true' : 'false'">
        <li v-for="(row, index) in rows" :key="`${index}-${row.content}`" :data-status="row.status">
          <span aria-hidden="true">{{ row.status === "completed" ? "✓" : row.status === "in_progress" ? "●" : "○" }}</span>
          <span>{{ row.content }}</span>
        </li>
      </ul>
    </div>
  </Transition>
</template>

<script>
export default {
  name: "LaresDesktopTodos",
  props: {
    rows: { type: Array, default: () => [] },
    t: { type: Function, required: true },
  },
  data() {
    return { open: true };
  },
  computed: {
    done() {
      return this.rows.filter((row) => row.status === "completed").length;
    },
  },
};
</script>

<style scoped>
.desktop-todos { box-sizing:border-box; width:calc(100% - 24px); margin:0 auto -3px; border:1px solid var(--q-separator); border-bottom:0; border-radius:12px 12px 0 0; padding:3px 0 6px; background:var(--q-background-3); color:var(--q-ink-2); font-size:13px; }
.desktop-todos__header { display:flex; width:100%; height:32px; align-items:center; justify-content:space-between; border:0; padding:0 12px; background:transparent; color:inherit; font:inherit; font-weight:500; cursor:pointer; }
.desktop-todos__chevron { display:inline-block; transition:transform var(--lares-duration-fast, 120ms) var(--lares-ease-out, ease); }
.desktop-todos__chevron[data-open="false"] { transform:rotate(180deg); }
.desktop-todos__list { max-height:0; overflow:hidden; margin:0; padding:0 12px; list-style:none; opacity:0; transition:max-height var(--lares-duration-normal, 220ms) var(--lares-ease-out, cubic-bezier(0.32, 0.72, 0, 1)), opacity var(--lares-duration-normal, 220ms) var(--lares-ease-out, cubic-bezier(0.32, 0.72, 0, 1)); }
.desktop-todos__list[data-open="true"] { max-height:120px; overflow:auto; opacity:1; }
@media (prefers-reduced-motion: reduce) {
  .desktop-todos__chevron,
  .desktop-todos__list { transition:none; }
  .desktop-todos__list[data-open="false"] { opacity:1; }
}
.desktop-todos li { display:flex; min-height:25px; align-items:flex-start; gap:8px; }
.desktop-todos li > span:first-child { color:var(--q-ink-3); }
.desktop-todos li[data-status="in_progress"] > span:first-child { color:var(--q-blue-default); }
.desktop-todos li[data-status="completed"] { color:var(--q-ink-3); text-decoration:line-through; }
</style>
