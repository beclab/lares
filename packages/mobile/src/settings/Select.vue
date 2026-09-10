<template>
  <div class="lares-select">
    <LaresPcPopover v-model="open" width="anchor" placement="bottom-start">
      <template #trigger="{ toggle }">
        <button
          type="button"
          class="lares-select__trigger"
          :disabled="disabled"
          aria-haspopup="listbox"
          :aria-expanded="open ? 'true' : 'false'"
          @click="toggle"
        >
          <span class="lares-select__value">{{ currentLabel }}</span>
          <svg class="lares-select__chevron" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6.5 9 12 14.5 17.5 9" />
          </svg>
        </button>
      </template>
      <div class="lares-select__menu" role="listbox">
        <p v-if="emptyText" class="lares-select__empty">{{ emptyText }}</p>
        <template v-for="section in sections" :key="section.heading || 'main'">
          <p v-if="section.heading" class="lares-select__heading">{{ section.heading }}</p>
          <button
            v-for="item in section.items"
            :key="item.id"
            type="button"
            class="lares-select__option"
            role="option"
            :aria-selected="item.id === value"
            :disabled="disabled"
            @click="choose(item)"
          >
            <span>{{ item.label }}</span>
            <svg v-if="item.id === value" class="lares-select__check" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12.5 9.5 17 19 7.5" />
            </svg>
          </button>
        </template>
      </div>
    </LaresPcPopover>
  </div>
</template>

<script>
import LaresPcPopover from "../desktop/ui/PcPopover.vue";

export default {
  name: "LaresSelect",
  components: { LaresPcPopover },
  props: {
    value: { type: String, default: "" },
    sections: { type: Array, default: () => [] },
    disabled: { type: Boolean, default: false },
    empty: { type: String, default: "" },
  },
  emits: ["select"],
  data() {
    return { open: false };
  },
  computed: {
    currentLabel() {
      for (const section of this.sections) {
        for (const item of section.items) {
          if (item.id === this.value) return item.label;
        }
      }
      return "—";
    },
    itemCount() {
      return this.sections.reduce((sum, section) => sum + section.items.length, 0);
    },
    emptyText() {
      return this.itemCount === 0 ? this.empty : "";
    },
  },
  methods: {
    choose(item) {
      this.open = false;
      this.$emit("select", item);
    },
  },
};
</script>

<style scoped>
.lares-select {
  width: 100%;
}

.lares-select__trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  width: 100%;
  height: 32px;
  padding: 0 8px 0 12px;
  border: 1px solid var(--q-separator);
  border-radius: 8px;
  background: transparent;
  color: var(--q-ink-2);
  text-align: left;
  cursor: pointer;
}

.lares-select__trigger:disabled {
  cursor: default;
  opacity: 0.5;
}

.lares-select__value {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: 15px;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lares-select__chevron,
.lares-select__check {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  fill: none;
  stroke: var(--q-ink-3);
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.lares-select__check {
  width: 16px;
  height: 16px;
  stroke: var(--q-blue-default);
}

.lares-select__menu {
  margin: -2px;
}

.lares-select__empty,
.lares-select__heading {
  margin: 0;
  padding: 8px;
  color: var(--q-ink-3);
  font-size: 14px;
  font-weight: 500;
  line-height: 18px;
}

.lares-select__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--q-ink-2);
  font-size: 15px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
}

.lares-select__option span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lares-select__option:hover:not(:disabled) {
  background: var(--q-background-hover);
}

.lares-select__option[aria-selected="true"] span {
  color: var(--q-blue-default);
}
</style>
