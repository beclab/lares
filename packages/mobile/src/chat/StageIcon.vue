<template>
  <svg
    class="lares-stage-icon"
    :viewBox="glyph.viewBox"
    :width="14"
    :height="14"
    aria-hidden="true"
    fill="none"
  >
    <path
      v-for="(p, i) in glyph.paths"
      :key="i"
      :d="p.d"
      :fill-rule="p.fillRule"
      :clip-rule="p.clipRule"
      :transform="p.transform"
      fill="currentColor"
    />
  </svg>
</template>

<script>
import { GLYPHS } from "./stage-icons.js";

export default {
  name: "LaresStageIcon",
  props: {
    name: { type: String, required: true },
  },
  computed: {
    glyph() {
      return GLYPHS[this.name] || GLYPHS.sparkle;
    },
  },
};
</script>

<style scoped>
.lares-stage-icon {
  display: block;
  flex: none;
}
</style>
