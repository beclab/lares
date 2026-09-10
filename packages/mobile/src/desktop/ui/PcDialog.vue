<template>
  <Teleport to="body">
    <Transition name="lares-dialog">
      <div
        v-if="open"
        class="lares-pc-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :data-variant="variant || undefined"
      >
        <button class="lares-pc-dialog__backdrop" type="button" :aria-label="closeLabel" @click="close" />
        <section class="lares-pc-dialog__surface" :style="{ width: surfaceWidth }">
        <header class="lares-pc-dialog__header">
          <slot name="header" :title-id="titleId">
            <div class="lares-pc-dialog__title">
              <h2 :id="titleId">{{ title }}</h2>
              <button type="button" class="lares-pc-dialog__close" :aria-label="closeLabel" @click="close">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
              </button>
            </div>
            <p v-if="description">{{ description }}</p>
          </slot>
        </header>
        <div class="lares-pc-dialog__body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="lares-pc-dialog__footer">
          <slot name="footer" />
        </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script>
let dialogId = 0;

export default {
  name: "LaresPcDialog",
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    closeLabel: { type: String, default: "Close" },
    width: { type: [Number, String], default: 440 },
    busy: { type: Boolean, default: false },
    variant: { type: String, default: "" },
  },
  emits: ["close"],
  data() {
    dialogId += 1;
    return { titleId: `lares-pc-dialog-${dialogId}` };
  },
  computed: {
    surfaceWidth() {
      return typeof this.width === "number" ? `${this.width}px` : this.width;
    },
  },
  watch: {
    open(value) {
      if (value) window.addEventListener("keydown", this.onKey);
      else window.removeEventListener("keydown", this.onKey);
    },
  },
  beforeUnmount() {
    window.removeEventListener("keydown", this.onKey);
  },
  methods: {
    close() {
      if (!this.busy) this.$emit("close");
    },
    onKey(event) {
      if (event.key === "Escape") this.close();
    },
  },
};
</script>

<style scoped>
.lares-pc-dialog { position:fixed; z-index:10000; inset:0; display:grid; place-items:center; color:var(--q-ink-1); }
.lares-pc-dialog__backdrop { position:absolute; inset:0; border:0; background:rgb(0 0 0 / 46%); }
.lares-pc-dialog__surface { position:relative; display:flex; max-width:calc(100vw - 48px); max-height:calc(100vh - 48px); flex-direction:column; overflow:hidden; border:1px solid var(--q-separator); border-radius:12px; background:var(--q-background-1); box-shadow:0 18px 60px rgb(0 0 0 / 32%); }
/* 12px + the 30px close button + 12px keeps a title-only header at 54px. */
.lares-pc-dialog__header { display:flex; flex-shrink:0; flex-direction:column; padding:12px 16px; border-bottom:1px solid var(--q-separator); }
.lares-pc-dialog__title { display:flex; min-height:30px; align-items:center; justify-content:space-between; gap:16px; }
.lares-pc-dialog__header h2 { margin:0; font-size:17px; font-weight:600; line-height:22px; }
.lares-pc-dialog__header p { margin:2px 0 0; color:var(--q-ink-3); font-size:13px; line-height:18px; }
.lares-pc-dialog__close { display:grid; width:30px; height:30px; flex-shrink:0; place-items:center; border:0; border-radius:7px; background:transparent; color:var(--q-ink-2); cursor:pointer; }
.lares-pc-dialog__close:hover { background:var(--q-background-hover); }
.lares-pc-dialog__close svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; }
.lares-pc-dialog__body { min-height:0; overflow:auto; padding:16px; }
.lares-pc-dialog__footer { display:flex; min-height:58px; flex-shrink:0; align-items:center; justify-content:flex-end; gap:8px; padding:0 16px; border-top:1px solid var(--q-separator); }
/* The directory variant only changes geometry; colors stay on the shared tokens. */
.lares-pc-dialog[data-variant="directory"] .lares-pc-dialog__surface { border-radius:20px; }
.lares-pc-dialog[data-variant="directory"] .lares-pc-dialog__header { padding:0; }
.lares-pc-dialog[data-variant="directory"] .lares-pc-dialog__body { padding:0; }
.lares-pc-dialog[data-variant="directory"] .lares-pc-dialog__footer { min-height:62px; padding:0 22px; }
</style>
