<template>
  <span
    ref="anchor"
    class="lares-pc-tooltip"
    @mouseenter="schedule"
    @mouseleave="hide"
    @focusin="schedule"
    @focusout="hide"
    @click="hide"
  >
    <slot />
    <Teleport to="body">
      <div v-if="shown" class="lares-pc-tooltip__chip" role="tooltip" :style="chip">{{ label }}</div>
    </Teleport>
  </span>
</template>

<script>
export default {
  name: "LaresPcTooltip",
  props: {
    label: { type: String, default: "" },
    placement: { type: String, default: "bottom" },
    delay: { type: Number, default: 120 },
  },
  data() {
    return {
      open: false,
      timer: 0,
      chip: { top: "0px", left: "0px" },
    };
  },
  computed: {
    shown() {
      return this.open && Boolean(this.label);
    },
  },
  watch: {
    label(value) {
      if (this.open && value) this.$nextTick(this.place);
    },
  },
  beforeUnmount() {
    this.hide();
  },
  methods: {
    schedule() {
      if (!this.label) return;
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        this.open = true;
        window.addEventListener("scroll", this.hide, true);
        this.$nextTick(this.place);
      }, this.delay);
    },
    hide() {
      window.clearTimeout(this.timer);
      this.timer = 0;
      if (!this.open) return;
      this.open = false;
      window.removeEventListener("scroll", this.hide, true);
    },
    place() {
      const anchor = this.$refs.anchor;
      if (!anchor) return;
      const box = anchor.getBoundingClientRect();
      const gap = 4;
      const above = this.placement === "top";
      this.chip = {
        top: above ? `${Math.max(6, box.top - gap)}px` : `${box.bottom + gap}px`,
        left: `${Math.max(6, box.left)}px`,
        transform: above ? "translateY(-100%)" : "none",
      };
    },
  },
};
</script>

<style scoped>
.lares-pc-tooltip { display:inline-flex; min-width:0; }
.lares-pc-tooltip__chip {
  position:fixed;
  z-index:9500;
  max-width:260px;
  border-radius:6px;
  padding:4px 8px;
  background:var(--q-background-3);
  color:var(--q-ink-1);
  font-size:14px;
  line-height:18px;
  white-space:nowrap;
  pointer-events:none;
  box-shadow:0 4px 14px rgb(0 0 0 / 24%);
}
</style>
