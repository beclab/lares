<template>
  <section class="lares-tts-settings">
    <h3>{{ t('settings.tts.title') }}</h3>
    <label>{{ t('settings.tts.model') }}
      <select :value="view.value.config.ttsModel || ''" :disabled="state.saving" @change="save(controller.selectModel($event.target.value))">
        <option value="">{{ t('settings.model.auto') }}</option>
        <option v-for="id in models" :key="id" :value="id">{{ id }}</option>
      </select>
    </label>
    <p v-if="view.errors.ttsModel" role="alert">{{ t('settings.saveFailed') }}</p>
    <p v-if="!state.model">{{ t('preferences.modelsMissing') }}</p>
    <p v-else-if="state.loading" role="status">{{ t('tts.loading') }}</p>
    <p v-else-if="state.error" role="alert">{{ t('tts.loadFailed') }} <button type="button" @click="controller.load()">{{ t('dictation.retry') }}</button></p>
    <label v-else-if="state.voices.length || state.unavailable">{{ t('tts.voice') }}
      <select :value="state.selected" :disabled="state.saving" @change="save(controller.selectVoice($event.target.value))">
        <option value="">{{ t('tts.default') }}</option>
        <option v-if="state.unavailable" :value="state.selected" disabled>{{ state.selected }} · {{ t('preferences.unavailable') }}</option>
        <option v-for="voice in state.voices" :key="voice.id" :value="voice.id">{{ voice.label }}</option>
      </select>
    </label>
    <p v-else>{{ t('tts.noPresets') }}</p>
    <p v-if="view.errors.ttsVoiceByModel" role="alert">{{ t('settings.saveFailed') }}</p>
    <div class="lares-tts-settings__preview">
      <button type="button" :disabled="!state.model || state.loading || Boolean(state.error) || state.saving || state.unavailable || state.blocked" @click="controller.audition()">{{ t(state.playing ? 'tts.stopPreview' : 'tts.preview') }}</button>
      <p role="status">{{ t(state.blocked ? 'tts.busy' : 'tts.previewHint') }}</p>
    </div>
    <p v-if="state.previewError" role="alert">{{ t('tts.previewFailed') }}</p>
    <label class="lares-tts-settings__speak"><input type="checkbox" :checked="view.value.config.speak === true" :disabled="Boolean(view.pending.speak)" @change="save(preferences.patch({ speak: $event.target.checked }))" />{{ t('settings.speak.title') }}</label>
    <p v-if="view.errors.speak" role="alert">{{ t('settings.saveFailed') }}</p>
  </section>
</template>
<script>
import { markRaw } from "vue";
import { createTtsSettings } from "@olares/lares-core/voice/tts-settings";
import { fetchTtsVoices } from "@olares/lares-core/voice/tts-voice";
import { previewTts } from "@olares/lares-core/voice/tts-preview";
export default {
  props: { preferences: { type: Object, required: true }, view: { type: Object, required: true }, t: { type: Function, required: true }, fetcher: { type: Function, required: true } },
  data() {
    const controller = markRaw(createTtsSettings({ preferences: this.preferences, list: (model, options) => fetchTtsVoices(model, { ...options, fetcher: this.fetcher }), preview: take => previewTts(take, { fetcher: this.fetcher }) }));
    return { controller, state: controller.getSnapshot() };
  },
  computed: { models() { return [...new Set([this.view.value.config.ttsModel, ...(this.view.value.ttsModels || [])].filter(Boolean))]; } },
  mounted() { this.off = this.controller.subscribe(() => { this.state = this.controller.getSnapshot(); }); void this.controller.load(); },
  beforeUnmount() { this.off?.(); this.controller.dispose(); },
  methods: { save(operation) { void operation.catch(() => {}); } },
};
</script>
<style scoped>
.lares-tts-settings { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.lares-tts-settings label { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.lares-tts-settings select { width: 100%; min-width: 0; max-width: 100%; font: inherit; color: inherit; border: 1px solid var(--q-separator); border-radius: 8px; background: var(--q-background-2, transparent); padding: 10px; }
.lares-tts-settings button:disabled { opacity: .45; cursor: default; }
.lares-tts-settings button:focus-visible, .lares-tts-settings select:focus-visible { outline: 2px solid var(--q-blue-default, #3978f6); outline-offset: 2px; }
.lares-tts-settings button { font: inherit; color: inherit; border: 1px solid var(--q-separator); border-radius: 8px; background: transparent; padding: 8px 14px; }
.lares-tts-settings p { margin: 0; font-size: 13px; color: var(--q-ink-3); }
.lares-tts-settings [role="alert"] { color: var(--q-orange-default); }
.lares-tts-settings label.lares-tts-settings__speak { flex-direction: row; align-items: center; }
.lares-tts-settings__preview { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
</style>
