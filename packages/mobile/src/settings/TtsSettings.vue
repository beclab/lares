<template>
  <section class="lares-tts">
    <h3>{{ t('settings.tts.title') }}</h3>
    <label v-if="isDesktop" class="lares-tts__field">
      <span>{{ t('settings.tts.model') }}</span>
      <LaresSelect :value="modelId" :sections="modelSections" :disabled="state.saving" @select="chooseModel" />
    </label>
    <LaresSettingRow
      v-else
      :label="t('settings.tts.model')"
      :value="modelLabel"
      chevron
      boxed
      :disabled="state.saving"
      @click="sheet = 'model'"
    />
    <p v-if="view.errors.ttsModel" class="lares-tts__alert" role="alert">{{ t('settings.saveFailed') }}</p>
    <p v-if="!state.model" class="lares-tts__hint">{{ t('preferences.modelsMissing') }}</p>
    <p v-else-if="state.loading" class="lares-tts__hint" role="status">{{ t('tts.loading') }}</p>
    <div v-else-if="state.error" class="lares-tts__status" role="alert">
      <p>{{ t('tts.loadFailed') }}</p>
      <button type="button" @click="controller.load()">{{ t('dictation.retry') }}</button>
    </div>
    <template v-else-if="state.voices.length || state.unavailable">
      <label v-if="isDesktop" class="lares-tts__field">
        <span>{{ t('tts.voice') }}</span>
        <LaresSelect :value="voiceId" :sections="voiceSections" :disabled="state.saving" @select="chooseVoice" />
      </label>
      <LaresSettingRow
        v-else
        :label="t('tts.voice')"
        :value="voiceLabel"
        chevron
        boxed
        :disabled="state.saving"
        @click="sheet = 'voice'"
      />
    </template>
    <p v-else class="lares-tts__hint">{{ t('tts.noPresets') }}</p>
    <p v-if="view.errors.ttsVoiceByModel" class="lares-tts__alert" role="alert">{{ t('settings.saveFailed') }}</p>
    <div class="lares-tts__action">
      <p class="lares-tts__hint">{{ t(state.blocked ? 'tts.busy' : 'tts.previewHint') }}</p>
      <button type="button" :disabled="previewDisabled" @click="controller.audition()">{{ t(state.playing ? 'tts.stopPreview' : 'tts.preview') }}</button>
    </div>
    <p v-if="state.previewError" class="lares-tts__alert" role="alert">{{ t('tts.previewFailed') }}</p>
    <label class="lares-tts__switch">
      <span>{{ t('settings.speak.title') }}</span>
      <input type="checkbox" role="switch" :checked="view.value.config.speak === true" :disabled="Boolean(view.pending.speak)" :aria-checked="view.value.config.speak === true ? 'true' : 'false'" @change="save(preferences.patch({ speak: $event.target.checked }))" />
    </label>
    <p class="lares-tts__hint">{{ t('settings.tts.hint') }}</p>
    <p v-if="view.errors.speak" class="lares-tts__alert" role="alert">{{ t('settings.saveFailed') }}</p>
    <LaresSheet v-if="!isDesktop" :open="Boolean(sheet)" :title="sheetTitle" @close="sheet = ''">
      <LaresSettingRow
        v-for="item in sheetItems"
        :key="item.id || 'auto'"
        :label="item.label"
        :checked="item.id === sheetCurrent"
        :disabled="state.saving || item.disabled"
        @click="chooseSheet(item)"
      />
    </LaresSheet>
  </section>
</template>
<script>
import { markRaw } from "vue";
import { createTtsSettings } from "@olares/lares-core/voice/tts-settings";
import { fetchTtsVoices } from "@olares/lares-core/voice/tts-voice";
import { previewTts } from "@olares/lares-core/voice/tts-preview";
import LaresSettingRow from "./SettingRow.vue";
import LaresSelect from "./Select.vue";
import LaresSheet from "./Sheet.vue";
export default {
  components: { LaresSettingRow, LaresSelect, LaresSheet },
  props: { preferences: { type: Object, required: true }, view: { type: Object, required: true }, t: { type: Function, required: true }, fetcher: { type: Function, required: true }, device: { type: String, default: "mobile" } },
  data() {
    const controller = markRaw(createTtsSettings({ preferences: this.preferences, list: (model, options) => fetchTtsVoices(model, { ...options, fetcher: this.fetcher }), preview: take => previewTts(take, { fetcher: this.fetcher }) }));
    return { controller, state: controller.getSnapshot(), sheet: "" };
  },
  computed: {
    isDesktop() { return this.device === "desktop"; },
    models() { return [...new Set([this.view.value.config.ttsModel, ...(this.view.value.ttsModels || [])].filter(Boolean))]; },
    modelId() { return this.view.value.config.ttsModel || ""; },
    modelLabel() { return this.modelId ? this.modelId : this.t("settings.model.auto"); },
    modelSections() { return [{ items: [{ id: "", label: this.t("settings.model.auto") }, ...this.models.map(id => ({ id, label: id }))] }]; },
    voiceId() { return this.state.selected || ""; },
    voiceItems() {
      return [
        { id: "", label: this.t("tts.default") },
        ...(this.state.unavailable && this.state.selected ? [{ id: this.state.selected, label: `${this.state.selected} · ${this.t("preferences.unavailable")}`, disabled: true }] : []),
        ...this.state.voices.map(voice => ({ id: voice.id, label: voice.label })),
      ];
    },
    voiceSections() { return [{ items: this.voiceItems }]; },
    voiceLabel() { return this.voiceItems.find(item => item.id === this.voiceId)?.label || this.t("tts.default"); },
    previewDisabled() { return !this.state.model || this.state.loading || Boolean(this.state.error) || this.state.saving || this.state.unavailable || this.state.blocked; },
    sheetTitle() { return this.t(this.sheet === "voice" ? "tts.voice" : "settings.tts.model"); },
    sheetItems() { return this.sheet === "voice" ? this.voiceItems : this.modelSections[0].items; },
    sheetCurrent() { return this.sheet === "voice" ? this.voiceId : this.modelId; },
  },
  mounted() { this.off = this.controller.subscribe(() => { this.state = this.controller.getSnapshot(); }); void this.controller.load(); },
  beforeUnmount() { this.off?.(); this.controller.dispose(); },
  methods: {
    save(operation) { void operation.catch(() => {}); },
    chooseModel(item) { this.save(this.controller.selectModel(item.id)); },
    chooseVoice(item) { if (!item.disabled) this.save(this.controller.selectVoice(item.id)); },
    chooseSheet(item) {
      if (item.disabled || this.state.saving) return;
      const sheet = this.sheet;
      this.sheet = "";
      if (item.id === (sheet === "voice" ? this.voiceId : this.modelId)) return;
      if (sheet === "voice") this.chooseVoice(item);
      else this.chooseModel(item);
    },
  },
};
</script>
<style scoped>
.lares-tts {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  color: var(--q-ink-1);
  font-size: 15px;
  line-height: 22px;
}

.lares-tts h3 {
  margin: 4px 0 0;
  color: var(--q-ink-3);
  font-size: 14px;
  font-weight: 500;
  line-height: 18px;
}

.lares-tts__field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.lares-tts__hint {
  margin: 0;
  color: var(--q-ink-3);
  font-size: 15px;
  line-height: 22px;
}

.lares-tts__alert {
  margin: 0;
  color: var(--q-orange-default);
  font-size: 15px;
  line-height: 22px;
}

.lares-tts__status {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
}

.lares-tts__status p {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: var(--q-orange-default);
  font-size: 15px;
  line-height: 22px;
}

.lares-tts__status > button,
.lares-tts__action > button {
  flex: none;
  min-height: 36px;
  border: 0;
  border-radius: 12px;
  padding: 0 14px;
  background: var(--q-blue-alpha);
  color: var(--q-blue-default);
  font: inherit;
  font-size: 15px;
  font-weight: 500;
  line-height: 20px;
  cursor: pointer;
}

.lares-tts__status > button:disabled,
.lares-tts__action > button:disabled {
  cursor: default;
  opacity: 0.45;
}

.lares-tts__status > button:focus-visible,
.lares-tts__action > button:focus-visible {
  outline: 2px solid var(--q-blue-default);
  outline-offset: 2px;
}

.lares-tts__action,
.lares-tts__switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 64px;
  box-sizing: border-box;
  border: 1px solid var(--q-separator);
  border-radius: 20px;
  padding: 12px 16px;
}

.lares-tts__action .lares-tts__hint {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  line-height: 22px;
}

.lares-tts__switch > span {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  line-height: 22px;
}

.lares-tts__switch {
  cursor: pointer;
}

.lares-tts__switch input {
  position: relative;
  flex: none;
  width: 44px;
  height: 26px;
  margin: 0;
  border: 0;
  border-radius: 999px;
  background: var(--q-background-3);
  appearance: none;
  cursor: pointer;
}

.lares-tts__switch input::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--q-ink-1);
  transition: transform var(--lares-duration-fast, 160ms) var(--lares-ease-out, ease);
}

.lares-tts__switch input:checked {
  background: var(--q-blue-default);
}

.lares-tts__switch input:checked::after {
  background: var(--q-ink-on-brand);
  transform: translateX(18px);
}

.lares-tts__switch input:disabled {
  cursor: default;
  opacity: 0.45;
}

.lares-tts__switch input:focus-visible {
  outline: 2px solid var(--q-blue-default);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .lares-tts__switch input::after {
    transition: none;
  }
}
</style>
