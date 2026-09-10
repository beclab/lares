<template>
  <LaresSheet :open="open" :title="t('desktop.newFolder')" @close="$emit('close')">
    <div class="mobile-directory-new">
      <input
        ref="input"
        v-model="value"
        class="mobile-directory-new__input"
        :placeholder="t('desktop.untitledFolder')"
        :disabled="busy"
        @keydown.enter.prevent="submit"
      />
      <div class="mobile-directory-new__actions">
        <button type="button" class="mobile-directory-new__cancel" :disabled="busy" @click="$emit('close')">
          {{ t("desktop.cancel") }}
        </button>
        <button
          type="button"
          class="mobile-directory-new__create"
          :disabled="busy || !value.trim()"
          @click="submit"
        >
          {{ t("desktop.createFolder") }}
        </button>
      </div>
    </div>
  </LaresSheet>
</template>

<script>
import LaresSheet from "../settings/Sheet.vue";

export default {
  name: "LaresMobileDirectoryNewFolder",
  components: { LaresSheet },
  props: {
    open: { type: Boolean, default: false },
    busy: { type: Boolean, default: false },
    t: { type: Function, required: true },
  },
  emits: ["close", "create"],
  data() {
    return { value: "" };
  },
  watch: {
    open(value) {
      if (!value) {
        this.value = "";
        return;
      }
      this.value = this.t("desktop.untitledFolder");
      this.$nextTick(() => {
        this.$refs.input?.focus();
        this.$refs.input?.select();
      });
    },
  },
  methods: {
    submit() {
      const name = this.value.trim();
      if (!name || this.busy) return;
      this.$emit("create", name);
    },
  },
};
</script>

<style scoped>
.mobile-directory-new {
  padding: 0 20px;
}

.mobile-directory-new__input {
  box-sizing: border-box;
  width: 100%;
  height: 44px;
  border: 1px solid var(--q-input-stroke, var(--q-separator));
  border-radius: 999px;
  padding: 0 16px;
  background: transparent;
  color: var(--q-ink-1);
  font: inherit;
  font-size: 16px;
}

.mobile-directory-new__input:focus {
  outline: none;
  border-color: var(--q-blue-default);
}

.mobile-directory-new__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.mobile-directory-new__cancel,
.mobile-directory-new__create {
  min-height: 40px;
  border-radius: 10px;
  padding: 0 16px;
  font: inherit;
}

.mobile-directory-new__cancel {
  border: 1px solid var(--q-separator);
  background: transparent;
  color: var(--q-ink-2);
}

.mobile-directory-new__create {
  border: 0;
  background: var(--q-blue-default);
  color: var(--q-ink-on-brand);
}

.mobile-directory-new__cancel:disabled,
.mobile-directory-new__create:disabled {
  opacity: 0.5;
}
</style>
