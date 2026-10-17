<template>
  <div v-if="view.value" class="lares-voice-preferences">
    <div class="lares-voice-preferences__list" :aria-label="t('preferences.defaultPreset')">
      <div v-for="id in presets" :key="id" class="lares-voice-preferences__row">
        <span>{{ t(`dictation.${id}`) }}<small v-if="preferences.dirty(id)"> · {{ t('preferences.modified') }}</small></span>
        <div class="lares-voice-preferences__actions">
          <span v-if="id === view.value.config.dictationPreset" class="lares-voice-preferences__default">{{ t('preferences.default') }}</span>
          <button v-else type="button" :disabled="Boolean(view.pending.dictationPreset)" :aria-label="`${t('preferences.setDefault')} ${t(`dictation.${id}`)}`" @click="setDefault(id)">{{ t('preferences.setDefault') }}</button>
          <button type="button" :aria-pressed="view.editing === id" :aria-label="`${t('preferences.edit')} ${t(`dictation.${id}`)}`" @click="preferences.selectPreset(id)">{{ t('preferences.edit') }}</button>
        </div>
      </div>
    </div>
    <p v-if="view.errors.dictationPreset" role="alert">{{ t('settings.saveFailed') }}</p>
    <h3>{{ t('preferences.editing') }}：{{ t(`dictation.${view.editing}`) }}</h3>
    <p v-if="view.editing === 'raw'">{{ t('dictation.noLlm') }}</p>
    <div v-else class="lares-voice-preferences__editor">
      <label>{{ t('dictation.model') }}
        <select :value="profile.model" :disabled="profilePending" @change="preferences.edit(view.editing, { model: $event.target.value })">
          <option value="">{{ t('settings.model.none') }}</option>
          <option v-for="item in models" :key="item.id" :value="item.id" :disabled="item.disabled">{{ item.label }}</option>
        </select>
      </label>
      <label>{{ t('dictation.instructions') }}
        <textarea ref="instructions" :value="profile.instructions" :disabled="profilePending" rows="6" maxlength="8000" @input="preferences.edit(view.editing, { instructions: $event.target.value })" />
      </label>
      <div class="lares-voice-preferences__actions">
        <button type="button" :disabled="profilePending" @click="preferences.restore(view.editing)">{{ t('dictation.reset') }}</button>
        <template v-if="preferences.dirty(view.editing)">
          <button type="button" :disabled="profilePending" @click="preferences.discard([view.editing])">{{ t('preferences.cancel') }}</button>
          <button type="button" :disabled="profilePending" @click="saveProfile">{{ t(profilePending ? 'preferences.saving' : 'preferences.save') }}</button>
        </template>
      </div>
      <p v-if="view.errors[`profile:${view.editing}`]" role="alert">{{ t('settings.saveFailed') }}</p>
    </div>
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
        <button type="button" :disabled="guardView.saving" @click="guard.answer('save')">{{ t(guardView.saving ? 'preferences.saving' : 'preferences.save') }}</button>
      </div>
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

export default {
  components: { LaresSheet },
  props: { settings: { type: Object, required: true }, snapshot: { type: Object, default: null }, device: { type: String, default: "mobile" }, t: { type: Function, required: true }, bindBeforeLeave: { type: Function, default: undefined } },
  expose: ["beforeLeave", "reload", "patch"],
  emits: ["change"],
  data() {
    const settings = this.settings;
    const preferences = markRaw(createVoicePreferences({ load: options => settings.voice(options.force, { diagnostics: false }), save: patch => settings.saveVoice(patch, { diagnostics: false }) }));
    if (this.snapshot) preferences.accept(toRaw(this.snapshot));
    const guard = markRaw(createPreferencesGuard(preferences));
    const recorder = markRaw(createVoiceShortcutRecorder({ current: () => preferences.getSnapshot().value.config.dictationShortcuts, save: (id, key) => preferences.saveShortcut(id, key) }));
    return { preferences, guard, recorder, view: preferences.getSnapshot(), guardView: guard.getSnapshot(), shortcut: recorder.getSnapshot(), bindings: markRaw({}), presets: DICTATION_PRESETS, shortcutIds: ["default", ...DICTATION_PRESETS] };
  },
  computed: {
    profile() { return this.view.value && this.view.editing !== "raw" ? this.preferences.profile(this.view.editing) : null; },
    profilePending() { return Boolean(this.view.pending[`profile:${this.view.editing}`]); },
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
    async setDefault(id) { if (await this.beforeLeave()) await this.preferences.patch({ dictationPreset: id }).catch(() => {}); },
    async saveProfile() { try { await this.preferences.saveProfile(this.view.editing); this.$refs.instructions?.focus(); } catch { /* The shared store retains the draft and error. */ } },
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
.lares-voice-preferences { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.lares-voice-preferences h3 { margin: 8px 0 0; font-size: 15px; font-weight: 500; }
.lares-voice-preferences p { margin: 0; font-size: 13px; color: var(--q-ink-3); }
.lares-voice-preferences [role="alert"] { color: var(--q-orange-default); }
.lares-voice-preferences__row { display: flex; gap: 8px; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--q-separator); }
.lares-voice-preferences__row > span { flex: 1; min-width: 0; }
.lares-voice-preferences small, .lares-voice-preferences__default { color: var(--q-ink-3); font-size: 12px; }
.lares-voice-preferences__actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.lares-voice-preferences button, .lares-voice-preferences select { font: inherit; color: inherit; background: var(--q-background-2, transparent); border: 1px solid var(--q-separator); border-radius: 8px; padding: 6px 8px; cursor: pointer; max-width: 100%; }
.lares-voice-preferences button:disabled { opacity: .45; cursor: default; }
.lares-voice-preferences button[aria-pressed="true"], .lares-voice-preferences button[data-recording="true"] { outline: 2px solid var(--q-blue-default, #3978f6); }
.lares-voice-preferences button:focus-visible, .lares-voice-preferences textarea:focus-visible { outline: 2px solid var(--q-blue-default, #3978f6); outline-offset: 2px; }
.lares-voice-preferences__editor, .lares-voice-preferences label { display: flex; flex-direction: column; gap: 10px; }
.lares-voice-preferences textarea { box-sizing: border-box; width: 100%; min-height: 144px; padding: 10px; resize: vertical; color: inherit; background: transparent; border: 1px solid var(--q-separator); border-radius: 8px; font: inherit; line-height: 1.5; }
.lares-voice-preferences__shortcuts, .lares-voice-preferences__question { display: flex; flex-direction: column; gap: 12px; }
.lares-voice-preferences__question { padding: 12px 20px; }
</style>
