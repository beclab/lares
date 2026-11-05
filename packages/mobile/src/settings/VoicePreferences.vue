<template>
  <div v-if="view.value" class="lares-voice-preferences">
    <template v-if="device === 'desktop'">
      <label class="lares-voice-preferences__field">
        <span>{{ t('preferences.dictationStyle') }}</span>
        <LaresSelect :value="view.value.config.dictationPreset" :sections="presetSections" :disabled="guardView.selecting || Boolean(view.pending.dictationPreset)" @select="choosePreset" />
      </label>
      <p v-if="view.errors.dictationPreset" role="alert">{{ t('settings.saveFailed') }}</p>
      <p v-if="view.value.config.dictationPreset === 'raw'">{{ t('dictation.noLlm') }}</p>
      <div v-else class="lares-voice-preferences__editor">
        <label class="lares-voice-preferences__field">
          <span>{{ t('dictation.model') }}</span>
          <LaresSelect :value="profile.model" :sections="modelSections" :disabled="profilePending" @select="chooseModel" />
        </label>
        <label class="lares-voice-preferences__field">
          <span>{{ t('dictation.instructions') }}</span>
          <textarea ref="instructions" :value="profile.instructions" :disabled="profilePending" rows="6" maxlength="8000" @input="preferences.edit(view.value.config.dictationPreset, { instructions: $event.target.value })" />
        </label>
        <div class="lares-voice-preferences__actions">
          <button type="button" :disabled="profilePending" @click="preferences.restore(view.value.config.dictationPreset)">{{ t('dictation.reset') }}</button>
          <template v-if="preferences.dirty(view.value.config.dictationPreset)">
            <button type="button" :disabled="profilePending" @click="preferences.discard([view.value.config.dictationPreset])">{{ t('preferences.cancel') }}</button>
            <button type="button" class="is-primary" :disabled="profilePending" @click="saveProfile">{{ t(profilePending ? 'preferences.saving' : 'preferences.save') }}</button>
          </template>
        </div>
        <p v-if="view.errors[`profile:${view.value.config.dictationPreset}`]" role="alert">{{ t('settings.saveFailed') }}</p>
      </div>
    </template>
    <template v-else>
      <h3 class="lares-voice-preferences__section">{{ t('settings.stt.title') }}</h3>
      <div class="lares-voice-preferences__block">
        <slot name="lead" />
        <LaresSettingRow
          :label="t('preferences.dictationStyle')"
          :value="t(`dictation.${view.value.config.dictationPreset}`)"
          :hint="view.value.config.dictationPreset === 'raw' ? t('dictation.noLlm') : ''"
          chevron
          :disabled="guardView.selecting || Boolean(view.pending.dictationPreset)"
          @click="sheet = 'preset'"
        />
        <p v-if="view.errors.dictationPreset" role="alert">{{ t('settings.saveFailed') }}</p>
        <div v-if="view.value.config.dictationPreset !== 'raw'" class="lares-voice-preferences__editor">
          <LaresSettingRow
            :label="t('dictation.model')"
            :value="modelLabel"
            chevron
            :disabled="profilePending"
            @click="sheet = 'model'"
          />
          <label class="lares-voice-preferences__field">
            <span>{{ t('dictation.instructions') }}</span>
            <textarea ref="instructions" :value="profile.instructions" :disabled="profilePending" rows="6" maxlength="8000" @input="preferences.edit(view.value.config.dictationPreset, { instructions: $event.target.value })" />
          </label>
          <div class="lares-voice-preferences__actions">
            <button type="button" :disabled="profilePending" @click="preferences.restore(view.value.config.dictationPreset)">{{ t('dictation.reset') }}</button>
            <template v-if="preferences.dirty(view.value.config.dictationPreset)">
              <button type="button" :disabled="profilePending" @click="preferences.discard([view.value.config.dictationPreset])">{{ t('preferences.cancel') }}</button>
              <button type="button" class="is-primary" :disabled="profilePending" @click="saveProfile">{{ t(profilePending ? 'preferences.saving' : 'preferences.save') }}</button>
            </template>
          </div>
          <p v-if="view.errors[`profile:${view.value.config.dictationPreset}`]" role="alert">{{ t('settings.saveFailed') }}</p>
        </div>
      </div>
    </template>
    <TtsSettings :preferences="preferences" :view="view" :t="t" :fetcher="ttsFetch" :device="device" />
    <section v-if="device === 'desktop'" class="lares-voice-preferences__shortcuts">
      <h3>{{ t('preferences.shortcuts') }}</h3>
      <p>{{ t('preferences.shortcutScope') }}</p>
      <div v-for="id in shortcutIds" :key="id" data-voice-shortcut-recorder @keydown.capture="shortcutKey($event, false)" @keyup.capture="shortcutKey($event, true)" @focusout="shortcutBlur($event, id)">
        <div class="lares-voice-preferences__row">
          <span>{{ shortcutTitle(id) }}</span>
          <div class="lares-voice-preferences__actions">
            <button :ref="element => { bindings[id] = element; }" type="button" :disabled="Boolean(shortcut.pending[id])" :aria-label="`${shortcutTitle(id)}: ${shortcutLabel(id)}`" :data-recording="shortcut.action === id" @click="recorder.begin(id)">{{ shortcutLabel(id) }}</button>
            <button v-if="view.value.config.dictationShortcuts[id]" type="button" :disabled="Boolean(shortcut.pending[id])" :aria-label="`${t('preferences.clear')} ${shortcutTitle(id)}`" @click="recorder.clear(id)">×</button>
          </div>
        </div>
        <p v-if="shortcut.action === id" role="status">{{ t('preferences.shortcutHelp') }}</p>
        <p v-if="shortcut.errors[id]" role="alert">{{ t(`preferences.shortcutError.${shortcut.errors[id]}`) }}
          <button v-if="shortcut.failed[id] != null" type="button" :disabled="Boolean(shortcut.pending[id])" @click="recorder.retry(id)">{{ t('dictation.retry') }}</button>
        </p>
      </div>
    </section>
    <LaresSheet :open="guardView.open" :title="t('preferences.unsaved')" @close="guard.answer('continue')">
      <div class="lares-voice-preferences__question">
        <p>{{ t('preferences.unsavedHint') }}</p>
        <p v-if="guardView.error" role="alert">{{ t('settings.saveFailed') }}</p>
        <button type="button" :disabled="guardView.saving" @click="guard.answer('continue')">{{ t('preferences.continue') }}</button>
        <button type="button" :disabled="guardView.saving" @click="guard.answer('discard')">{{ t('preferences.discard') }}</button>
        <button type="button" class="is-primary" :disabled="guardView.saving" @click="guard.answer('save')">{{ t(guardView.saving ? 'preferences.saving' : 'preferences.save') }}</button>
      </div>
    </LaresSheet>
    <LaresSheet v-if="device !== 'desktop'" :open="Boolean(sheet)" :title="sheetTitle" @close="sheet = ''">
      <LaresSettingRow
        v-for="item in sheetItems"
        :key="item.id || 'none'"
        :label="item.label"
        :checked="item.id === sheetCurrent"
        :disabled="item.disabled || (sheet === 'preset' ? guardView.selecting : profilePending)"
        @click="chooseSheet(item)"
      />
    </LaresSheet>
  </div>
  <p v-else role="status">{{ t(view.loadError ? 'settings.loadFailed' : 'settings.loading') }}</p>
</template>

<script>
import { markRaw, toRaw } from "vue";
import { createVoicePreferences, createPreferencesGuard } from "@olares/lares-core/voice/preferences";
import { createVoiceShortcutRecorder, formatVoiceShortcut } from "@olares/lares-core/voice/shortcuts";
import { DICTATION_PRESETS } from "@olares/lares-core/voice/dictation";
import LaresSheet from "./Sheet.vue";
import LaresSettingRow from "./SettingRow.vue";
import LaresSelect from "./Select.vue";
import TtsSettings from "./TtsSettings.vue";

export default {
  components: { LaresSheet, LaresSettingRow, LaresSelect, TtsSettings },
  props: { ttsFetch: { type: Function, required: true }, settings: { type: Object, required: true }, snapshot: { type: Object, default: null }, device: { type: String, default: "mobile" }, t: { type: Function, required: true }, bindBeforeLeave: { type: Function, default: undefined } },
  expose: ["beforeLeave", "reload", "patch"],
  emits: ["change"],
  data() {
    const settings = this.settings;
    const preferences = markRaw(createVoicePreferences({ load: options => settings.voice(options.force, { diagnostics: false }), save: patch => settings.saveVoice(patch, { diagnostics: false }) }));
    if (this.snapshot) preferences.accept(toRaw(this.snapshot));
    const guard = markRaw(createPreferencesGuard(preferences));
    const recorder = markRaw(createVoiceShortcutRecorder({ current: () => preferences.getSnapshot().value.config.dictationShortcuts, save: (id, key) => preferences.saveShortcut(id, key) }));
    return { preferences, guard, recorder, view: preferences.getSnapshot(), guardView: guard.getSnapshot(), shortcut: recorder.getSnapshot(), bindings: markRaw({}), presets: DICTATION_PRESETS, shortcutIds: ["default", ...DICTATION_PRESETS], sheet: "" };
  },
  computed: {
    profile() { return this.view.value && this.view.value.config.dictationPreset !== "raw" ? this.preferences.profile(this.view.value.config.dictationPreset) : null; },
    presetSections() { return [{ items: this.presets.map(id => ({ id, label: this.t(`dictation.${id}`) })) }]; },
    modelSections() { return [{ items: [{ id: "", label: this.t("settings.model.none") }, ...this.models.map(item => ({ id: item.id, label: item.label, disabled: item.disabled }))] }]; },
    modelLabel() { return this.modelSections[0].items.find(item => item.id === (this.profile?.model || ""))?.label || this.t("settings.model.none"); },
    sheetTitle() { return this.t(this.sheet === "model" ? "dictation.model" : "preferences.dictationStyle"); },
    sheetItems() { return this.sheet === "model" ? this.modelSections[0].items : this.presetSections[0].items; },
    sheetCurrent() { return this.sheet === "model" ? (this.profile?.model || "") : this.view.value?.config.dictationPreset; },
    profilePending() { return this.guardView.selecting || Boolean(this.view.pending[`profile:${this.view.value.config.dictationPreset}`]); },
    models() {
      const available = this.view.value?.chatModels || [];
      return [...new Set([this.profile?.model, ...(available.length ? ["default-chat"] : []), ...available].filter(Boolean))].map(id => {
        const ready = available.includes(id) || id === "default-chat" && available.length > 0;
        return { id, label: ready ? id : `${id} · ${this.t('preferences.unavailable')}`, disabled: !ready };
      });
    },
  },
  watch: {
    snapshot(value) { if (value && toRaw(value) !== this.preferences.getSnapshot().value) this.preferences.accept(toRaw(value)); },
  },
  mounted() {
    this.offPreferences = this.preferences.subscribe(() => { this.view = this.preferences.getSnapshot(); if (this.view.value) this.$emit("change", this.view.value); });
    this.offGuard = this.guard.subscribe(() => { this.guardView = this.guard.getSnapshot(); });
    this.offShortcut = this.recorder.subscribe(() => {
      const previous = this.shortcut.pending; this.shortcut = this.recorder.getSnapshot();
      if (!this.shortcut.action && document.activeElement === document.body) {
        const id = Object.keys(previous).find(id => previous[id] && !this.shortcut.pending[id]);
        if (id) this.$nextTick(() => this.bindings[id]?.focus());
      }
    });
    this.offLeave = this.bindBeforeLeave?.(() => this.beforeLeave());
    this.onUnload = event => { if (this.preferences.dirtyIds().length) { event.preventDefault(); event.returnValue = ""; } };
    this.onEscape = event => { if (event.key === "Escape" && this.guardView.open) { event.preventDefault(); event.stopImmediatePropagation(); void this.guard.answer("continue"); } };
    window.addEventListener("beforeunload", this.onUnload); window.addEventListener("keydown", this.onEscape, true);
    if (this.snapshot) this.preferences.accept(toRaw(this.snapshot));
    void this.preferences.load().catch(() => {});
  },
  beforeUnmount() {
    this.offPreferences?.(); this.offGuard?.(); this.offShortcut?.(); this.offLeave?.(); this.guard.dispose();
    window.removeEventListener("beforeunload", this.onUnload); window.removeEventListener("keydown", this.onEscape, true);
  },
  methods: {
    beforeLeave() { return this.guard.request(); },
    async patch(partial) { if (!this.view.value) await this.preferences.load(); return this.preferences.patch(partial); },
    reload() { return this.preferences.load(true); },
    choosePreset(item) { void this.guard.selectPreset(item.id).catch(() => {}); },
    chooseModel(item) { if (!item.disabled) this.preferences.edit(this.view.value.config.dictationPreset, { model: item.id }); },
    chooseSheet(item) {
      if (item.disabled) return;
      const sheet = this.sheet;
      this.sheet = "";
      if (sheet === "model") this.chooseModel(item);
      else this.choosePreset(item);
    },
    async saveProfile() { try { await this.preferences.saveProfile(this.view.value.config.dictationPreset); this.$refs.instructions?.focus(); } catch { /* The shared store retains the draft and error. */ } },
    shortcutTitle(id) { return this.t(id === "default" ? "dictation.shortcut" : `dictation.${id}`); },
    shortcutLabel(id) {
      const mac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || "");
      return this.shortcut.action === id ? formatVoiceShortcut(this.shortcut.candidate, mac) || this.t("preferences.shortcutRecording") : this.shortcut.pending[id] ? this.t("preferences.saving") : formatVoiceShortcut(this.view.value.config.dictationShortcuts[id], mac) || this.t("preferences.unset");
    },
    shortcutKey(event, up) { if ((up ? this.recorder.keyup(event) : this.recorder.keydown(event))) { event.preventDefault(); event.stopPropagation(); } },
    shortcutBlur(event, id) { if (!event.currentTarget.contains(event.relatedTarget) && this.shortcut.action === id) this.recorder.cancel(); },
  },
};
</script>

<style scoped>
.lares-voice-preferences { display: flex; flex-direction: column; gap: 12px; min-width: 0; color: var(--q-ink-1); font-size: 15px; line-height: 22px; }
.lares-voice-preferences h3 { margin: 4px 0 0; color: var(--q-ink-3); font-size: 14px; font-weight: 500; line-height: 18px; }
.lares-voice-preferences__section { margin: 0; }
.lares-voice-preferences__block { display: flex; flex-direction: column; border: 1px solid var(--q-separator); border-radius: 20px; overflow: hidden; }
.lares-voice-preferences__block :deep(.lares-set-row) { min-height: 64px; }
.lares-voice-preferences__block > [role="alert"] { padding: 0 16px 12px; }
.lares-voice-preferences__block .lares-voice-preferences__editor { padding: 12px 16px 16px; border-top: 1px solid var(--q-separator); }
.lares-voice-preferences p { margin: 0; color: var(--q-ink-3); font-size: 15px; line-height: 22px; }
.lares-voice-preferences [role="alert"] { color: var(--q-orange-default); }
.lares-voice-preferences__field { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.lares-voice-preferences__field > span { color: var(--q-ink-2); }
.lares-voice-preferences__row { display: flex; gap: 12px; align-items: center; justify-content: space-between; min-height: 56px; padding: 12px 0; border-bottom: 1px solid var(--q-separator); }
.lares-voice-preferences__row > span { flex: 1; min-width: 0; font-size: 16px; line-height: 22px; }
.lares-voice-preferences__actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.lares-voice-preferences__actions button,
.lares-voice-preferences__question button,
.lares-voice-preferences__shortcuts button { min-height: 36px; border: 1px solid var(--q-separator); border-radius: 12px; padding: 0 14px; background: transparent; color: inherit; font: inherit; font-size: 15px; line-height: 20px; cursor: pointer; }
.lares-voice-preferences__actions button:disabled,
.lares-voice-preferences__question button:disabled,
.lares-voice-preferences__shortcuts button:disabled { opacity: .45; cursor: default; }
.lares-voice-preferences button.is-primary { border: 0; background: var(--q-blue-alpha); color: var(--q-blue-default); font-weight: 500; }
.lares-voice-preferences button[data-recording="true"] { outline: 2px solid var(--q-blue-default); }
.lares-voice-preferences__actions button:focus-visible,
.lares-voice-preferences__question button:focus-visible,
.lares-voice-preferences__shortcuts button:focus-visible,
.lares-voice-preferences textarea:focus-visible { outline: 2px solid var(--q-blue-default); outline-offset: 2px; }
.lares-voice-preferences__editor, .lares-voice-preferences__shortcuts, .lares-voice-preferences__question { display: flex; flex-direction: column; gap: 12px; }
.lares-voice-preferences textarea { box-sizing: border-box; width: 100%; min-height: 144px; padding: 12px 16px; resize: vertical; color: inherit; background: transparent; border: 1px solid var(--q-separator); border-radius: 16px; font: inherit; font-size: 16px; line-height: 1.5; }
.lares-voice-preferences__question { padding: 4px 20px 12px; }
.lares-voice-preferences__question button { width: 100%; }
</style>
