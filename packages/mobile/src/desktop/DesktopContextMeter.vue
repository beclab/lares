<template>
  <LaresPcPopover v-if="occupancy" v-model="open" :width="260" placement="top-end">
    <template #trigger="{ toggle }">
      <LaresPcTooltip :label="t('context.used', occupancy)" placement="top">
        <button
          type="button"
          class="desktop-context"
          :aria-label="t('context.used', occupancy)"
          @click="toggle"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="7" class="desktop-context__track" />
            <circle
              cx="10"
              cy="10"
              r="7"
              class="desktop-context__value"
              pathLength="100"
              :stroke-dasharray="`${occupancy.percent} 100`"
            />
          </svg>
        </button>
      </LaresPcTooltip>
    </template>
    <div class="desktop-context__panel">
      <strong>{{ t("context.title") }}</strong>
      <span>{{ t("context.used", occupancy) }}</span>
      <div class="desktop-context__bar"><i :style="{ width: `${occupancy.percent}%` }" /></div>
      <dl v-if="breakdown">
        <template v-for="row in rows" :key="row.key">
          <dt>{{ t(`context.${row.key}`) }}</dt>
          <dd>~{{ row.compact }}</dd>
        </template>
      </dl>
    </div>
  </LaresPcPopover>
</template>

<script>
import { occupancyBreakdown, occupancyFromPressure } from "@olares/lares-core/larepass/context-occupancy";
import LaresPcPopover from "./ui/PcPopover.vue";
import LaresPcTooltip from "./ui/PcTooltip.vue";

export default {
  name: "LaresDesktopContextMeter",
  components: { LaresPcPopover, LaresPcTooltip },
  props: {
    pressure: { type: Object, default: null },
    breakdown: { type: Object, default: null },
    t: { type: Function, required: true },
  },
  data() {
    return { open: false };
  },
  computed: {
    occupancy() {
      return occupancyFromPressure(this.pressure);
    },
    rows() {
      return occupancyBreakdown(this.breakdown);
    },
  },
};
</script>

<style scoped>
.desktop-context { display:grid; width:28px; height:28px; place-items:center; border:0; border-radius:50%; padding:0; background:transparent; color:var(--q-ink-3); cursor:pointer; }
.desktop-context:hover { background:var(--q-background-hover); color:var(--q-ink-2); }
.desktop-context svg { width:18px; height:18px; transform:rotate(-90deg); fill:none; }
.desktop-context circle { stroke-width:2.5; }
.desktop-context__track { stroke:var(--q-separator); }
.desktop-context__value { stroke:var(--q-blue-default); stroke-linecap:round; }
.desktop-context__panel { display:flex; flex-direction:column; gap:8px; padding:4px; color:var(--q-ink-2); font-size:12px; }
.desktop-context__panel strong { color:var(--q-ink-1); font-size:14px; }
.desktop-context__bar { height:6px; overflow:hidden; border-radius:3px; background:var(--q-background-3); }
.desktop-context__bar i { display:block; height:100%; border-radius:inherit; background:var(--q-blue-default); }
.desktop-context__panel dl { display:grid; grid-template-columns:1fr auto; gap:5px 12px; margin:3px 0 0; }
.desktop-context__panel dt,
.desktop-context__panel dd { margin:0; }
.desktop-context__panel dd { color:var(--q-ink-3); }
</style>
