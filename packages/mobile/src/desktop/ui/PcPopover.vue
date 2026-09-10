<template>
  <span ref="anchor" class="lares-pc-popover">
    <slot name="trigger" :open="modelValue" :toggle="toggle" :close="close" />
    <Teleport to="body">
      <Transition name="lares-popover">
        <div v-if="modelValue" class="lares-pc-popover__layer" @mousedown.self="close">
          <div
            ref="panel"
            class="lares-pc-popover__panel"
            :style="panelStyle"
            role="menu"
            @mousedown.stop
          >
            <slot :close="close" />
          </div>
        </div>
      </Transition>
    </Teleport>
  </span>
</template>

<script>
import { placePanel } from "./place.js";

export default {
  name: "LaresPcPopover",
  props: {
    modelValue: { type: Boolean, default: false },
    width: { type: [Number, String], default: 220 },
    placement: { type: String, default: "bottom-end" },
    minPanelHeight: { type: Number, default: 120 },
  },
  emits: ["update:modelValue"],
  data() {
    return {
      panel: { top: "", bottom: "", left: "0px", width: "220px", maxHeight: "320px" },
    };
  },
  computed: {
    panelStyle() {
      return this.panel;
    },
  },
  watch: {
    modelValue(open) {
      if (open) {
        window.addEventListener("resize", this.place);
        window.addEventListener("scroll", this.place, true);
        window.addEventListener("keydown", this.onKey);
        this.$nextTick(this.place);
      } else {
        this.unlisten();
      }
    },
  },
  beforeUnmount() {
    this.unlisten();
  },
  methods: {
    toggle() {
      this.$emit("update:modelValue", !this.modelValue);
    },
    close() {
      this.$emit("update:modelValue", false);
    },
    unlisten() {
      window.removeEventListener("resize", this.place);
      window.removeEventListener("scroll", this.place, true);
      window.removeEventListener("keydown", this.onKey);
    },
    onKey(event) {
      if (event.key === "Escape") this.close();
    },
    place() {
      const anchor = this.$refs.anchor;
      if (!anchor) return;
      const box = anchor.getBoundingClientRect();
      const width = this.width === "anchor"
        ? box.width
        : typeof this.width === "number"
          ? this.width
          : Number.parseFloat(this.width) || box.width;
      this.panel = placePanel({
        box,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        width,
        placement: this.placement,
        minHeight: this.minPanelHeight,
      });
    },
  },
};
</script>

<style scoped>
.lares-pc-popover { display:inline-flex; min-width:0; }
.lares-pc-popover__layer { position:fixed; z-index:9000; inset:0; }
.lares-pc-popover__panel {
  position:fixed;
  box-sizing:border-box;
  overflow-x:hidden;
  overflow-y:auto;
  border:1px solid var(--q-separator);
  border-radius:8px;
  padding:6px;
  background:var(--q-background-1);
  color:var(--q-ink-1);
  box-shadow:0 8px 28px rgb(0 0 0 / 20%);
}
</style>
