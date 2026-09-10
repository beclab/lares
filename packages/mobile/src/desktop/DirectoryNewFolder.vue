<template>
  <LaresPcDialog
    :open="open"
    :title="t('desktop.newFolder')"
    :close-label="t('desktop.close')"
    :busy="busy"
    :width="420"
    @close="$emit('close')"
  >
    <div class="directory-new-folder">
      <input
        ref="input"
        v-model="value"
        class="directory-new-folder__input"
        :placeholder="t('desktop.untitledFolder')"
        :disabled="busy"
        @keydown.enter.prevent="submit"
      />
    </div>
    <template #footer>
      <button type="button" class="directory-new-folder__cancel" :disabled="busy" @click="$emit('close')">
        {{ t("desktop.cancel") }}
      </button>
      <button
        type="button"
        class="directory-new-folder__create"
        :disabled="busy || !value.trim()"
        @click="submit"
      >
        {{ t("desktop.createFolder") }}
      </button>
    </template>
  </LaresPcDialog>
</template>

<script>
import LaresPcDialog from "./ui/PcDialog.vue";

export default {
  name: "LaresDirectoryNewFolder",
  components: { LaresPcDialog },
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
.directory-new-folder {
  padding-inline: 12px;
}

.directory-new-folder__input {
  box-sizing: border-box;
  width: 100%;
  height: 40px;
  border: 1px solid var(--q-input-stroke, var(--q-separator));
  border-radius: 999px;
  padding: 0 14px;
  background: transparent;
  color: var(--q-ink-1);
  font: inherit;
  font-size: 15px;
}

.directory-new-folder__input:focus {
  outline: none;
  border-color: var(--q-blue-default);
}

.directory-new-folder__cancel,
.directory-new-folder__create {
  min-width: 76px;
  height: 32px;
  border-radius: 999px;
  padding: 0 14px;
  font: inherit;
  cursor: pointer;
}

.directory-new-folder__cancel {
  border: 1px solid var(--q-separator);
  background: transparent;
  color: var(--q-ink-2);
}

.directory-new-folder__create {
  border: 0;
  background: var(--q-blue-default);
  color: var(--q-ink-on-brand);
}

.directory-new-folder__cancel:disabled,
.directory-new-folder__create:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
