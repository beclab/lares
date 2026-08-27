<template>
  <div class="lares-stage" :data-kind="kind" :data-open="open ? 'true' : 'false'">
    <button type="button" class="lares-stage__row" :aria-expanded="open" @click="open = !open">
      <span class="lares-stage__leading" aria-hidden="true">
        <LaresStageIcon :name="iconName" />
      </span>
      <span class="lares-stage__title">{{ title }}</span>
      <template v-if="summary">
        <span class="lares-stage__sep" aria-hidden="true" />
        <span class="lares-stage__summary">{{ summary }}</span>
      </template>
    </button>
    <pre v-if="open && body" class="lares-stage__body">{{ body }}</pre>
  </div>
</template>

<script>
import { stageIconOf } from "./stage-icons.js";
import LaresStageIcon from "./StageIcon.vue";

export default {
  name: "LaresStageRow",
  components: { LaresStageIcon },
  props: {
    kind: { type: String, default: "" },
    variant: { type: String, default: "" },
    title: { type: String, required: true },
    summary: { type: String, default: "" },
    body: { type: String, default: "" },
  },
  data() {
    return { open: false };
  },
  computed: {
    iconName() {
      return stageIconOf(this.kind, this.variant);
    },
  },
};
</script>

<style scoped>
.lares-stage {
  min-width: 0;
  max-width: 100%;
}

.lares-stage__row {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  min-height: 24px;
  border: 0;
  padding: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.lares-stage__leading {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-right: 6px;
  color: var(--q-ink-2);
}

.lares-stage__title {
  flex: none;
  color: var(--q-ink-2);
}

.lares-stage__title,
.lares-stage__summary {
  min-width: 0;
  overflow: hidden;
  font-size: 14px;
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lares-stage[data-kind="retry"] .lares-stage__title {
  flex: auto;
}

.lares-stage__summary {
  flex: auto;
  color: var(--q-ink-2);
}

.lares-stage__sep {
  flex: none;
  width: 2px;
  height: 2px;
  margin: 0 8px;
  border-radius: 1px;
  background: var(--q-ink-2);
}

.lares-stage__body {
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  max-height: 141px;
  margin: 4px 0 0 22px;
  border-radius: 8px;
  padding: 10px 12px;
  overflow: auto;
  background: var(--q-background-3);
  color: var(--q-ink-2);
  font: 400 11px/16px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.lares-stage[data-kind="think"] .lares-stage__body {
  max-height: none;
  margin: 6px 0 2px 2px;
  border-radius: 0;
  border-left: 2px solid var(--q-input-stroke);
  padding: 0 0 0 12px;
  background: transparent;
  font: 400 13px/1.6 inherit;
}
</style>
