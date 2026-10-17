<template>
  <dialog ref="dialog" class="lares-voice-panel" :data-mode="view.mode" :data-phase="ui.phase" :data-preview="ui.preview" aria-labelledby="lares-mobile-voice-title" @cancel.prevent="$emit('close')" @click="onBackdrop">
    <div class="lares-voice-panel-body">
      <header><h2 id="lares-mobile-voice-title">{{ t(`settings.mode.${view.mode}`) }}</h2><button type="button" class="lares-voice-close" :aria-label="t('panel.close')" @click="$emit('close')">×</button></header>
      <section class="lares-voice-content">
        <p class="lares-voice-status" role="status" aria-live="polite" aria-atomic="true">{{ status }}</p>
        <template v-if="ui.preview">
          <details ref="menu" class="lares-voice-menu">
            <summary :aria-label="t('dictation.preset')">{{ t(`dictation.${view.preset}`) }} ▾</summary>
            <div class="lares-voice-menu-body">
              <select :aria-label="t('dictation.preset')" :value="view.preset" :disabled="view.busy" @change="choose($event.target.value)"><option v-for="id in presets" :key="id" :value="id">{{ t(`dictation.${id}`) }}</option></select>
              <button type="button" @click="showOriginal = !showOriginal; closeMenu()">{{ t('dictation.original') }}</button>
              <template v-if="ui.error"><button type="button" :disabled="view.busy" @click="choose(view.preset)">{{ t('dictation.retry') }}</button><button type="button" :disabled="view.busy" @click="choose('raw')">{{ t('dictation.useOriginal') }}</button></template>
            </div>
          </details>
          <textarea class="lares-voice-draft" :aria-label="t('panel.draft')" :value="view.draft" :disabled="ui.pending" @input="$emit('edit', $event.target.value)" />
          <button v-if="view.stage === 'processing' && view.raw" type="button" @click="choose('raw')">{{ t('dictation.useOriginal') }}</button>
          <div v-if="showOriginal" class="lares-voice-original" :aria-label="t('dictation.original')">{{ view.raw }}</div>
        </template>
      </section>
      <footer class="lares-voice-panel-actions">
        <button type="button" class="lares-voice-primary" :disabled="view.busy || !view.draft.trim()" @click="$emit('complete')">{{ t('dictation.insert') }}</button>
        <button type="button" :disabled="view.busy" @click="$emit('discard')">{{ t('dictation.discard') }}</button>
      </footer>
    </div>
  </dialog>
</template>
<script>
import { messageFromCode } from '@olares/lares-core/i18n/t';
import { DICTATION_PRESETS } from '@olares/lares-core/voice/dictation';
import { voicePanelPresentation } from '@olares/lares-core/voice/presentation';
export default {
  name: 'LaresVoicePanel', props: { view: { type: Object, required: true }, t: { type: Function, required: true } },
  emits: ['close', 'complete', 'discard', 'edit', 'preset'],
  data: () => ({ previousFocus: null, presets: DICTATION_PRESETS, showOriginal: false }),
  computed: {
    ui() { return voicePanelPresentation(this.view); },
    status() { return this.ui.error ? messageFromCode(this.t, this.ui.error, "error.voice_failed") : this.t(this.ui.status); },
  },
  watch: { 'view.previewVisible': { immediate: true, handler() { this.$nextTick(this.sync); } } },
  mounted() {
    this.updateViewport(); window.addEventListener('resize', this.updateViewport);
    window.visualViewport?.addEventListener('resize', this.updateViewport); window.visualViewport?.addEventListener('scroll', this.updateViewport);
  },
  beforeUnmount() {
    this.$refs.dialog?.close(); this.restoreFocus();
    window.removeEventListener('resize', this.updateViewport); window.visualViewport?.removeEventListener('resize', this.updateViewport); window.visualViewport?.removeEventListener('scroll', this.updateViewport);
  },
  methods: {
    updateViewport() {
      const dialog = this.$refs.dialog; if (!dialog) return;
      const viewport = window.visualViewport; const height = viewport?.height || window.innerHeight;
      dialog.style.setProperty('--voice-view-height', `${height}px`);
      dialog.style.setProperty('--voice-bottom', `${Math.max(0, window.innerHeight - height - (viewport?.offsetTop || 0))}px`);
    },
    sync() {
      const dialog = this.$refs.dialog; if (!dialog) return;
      if (this.view.previewVisible) { if (!dialog.open) { this.previousFocus = document.querySelector('.lares-composer__icon[data-kind=voice]') || document.activeElement; dialog.showModal(); } this.updateViewport(); }
      else if (dialog.open) { dialog.close(); this.$nextTick(this.restoreFocus); this.showOriginal = false; }
    },
    onBackdrop(event) { if (event.target === this.$refs.dialog) this.$emit('close'); },
    closeMenu() { if (this.$refs.menu) this.$refs.menu.open = false; },
    choose(preset) { if (this.view.edited && !confirm(this.t('dictation.replaceEdited'))) return; this.closeMenu(); this.$emit('preset', preset); },
    restoreFocus() { const target = this.previousFocus?.isConnected ? this.previousFocus : document.querySelector('.lares-composer__icon[data-kind=voice]'); target?.focus?.(); },
  },
};
</script>
<style scoped>
.lares-voice-panel { position: fixed; inset: auto; margin: 0; box-sizing: border-box; padding: 0; border: 1px solid #8883; border-radius: 20px; color: var(--color-text-primary, #202124); background: var(--color-background-primary, white); width: min(400px, calc(var(--voice-view-width, 100vw) - 24px)); max-width: none; max-height: calc(var(--voice-view-height, 100dvh) * .85); box-shadow: 0 12px 48px #0002; overflow: hidden; }
.lares-voice-panel::backdrop { background: #10182826; }
.lares-voice-panel-body { padding: 16px; display: flex; flex-direction: column; box-sizing: border-box; max-height: calc(var(--voice-view-height, 100dvh) * .85 - 2px); }
.lares-voice-panel header { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 16px; }
.lares-voice-panel h2 { font-size: 16px; line-height: 24px; margin: 0; font-weight: 600; }
.lares-voice-panel button { font: inherit; color: inherit; cursor: pointer; border: 1px solid #8883; border-radius: 12px; padding: 10px 16px; min-height: 44px; box-sizing: border-box; background: transparent; }
.lares-voice-panel button:focus-visible, .lares-voice-panel summary:focus-visible, .lares-voice-panel textarea:focus-visible, .lares-voice-panel select:focus-visible { outline: 2px solid #3478f6; outline-offset: 2px; }
.lares-voice-panel button:disabled { opacity: .45; cursor: default; }
.lares-voice-panel .lares-voice-close { border: 0; padding: 0; font-size: 24px; min-width: 44px; }
.lares-voice-content { text-align: center; display: flex; flex-direction: column; min-height: 0; overflow: auto; }
.lares-voice-status { margin: 12px 0; min-height: 24px; line-height: 24px; font-size: 14px; }
.lares-voice-panel-actions { display: flex; flex: none; justify-content: center; align-items: center; gap: 10px; margin-top: 12px; }
.lares-voice-panel textarea { display: block; flex: 1 1 180px; width: 100%; box-sizing: border-box; min-height: 80px; height: 180px; max-height: 32dvh; margin: 12px 0 0; padding: 12px; color: inherit; background: #88808; font: inherit; line-height: 1.6; border: 1px solid #8883; border-radius: 12px; resize: none; overflow: auto; }
.lares-voice-panel select { font: inherit; padding: 8px 12px; border-radius: 10px; color: inherit; background: transparent; max-width: 100%; }
.lares-voice-menu { flex: none; text-align: start; font-size: 13px; }
.lares-voice-menu summary { display: inline-block; list-style: none; cursor: pointer; padding: 6px 10px; border-radius: 8px; background: #8881; }
.lares-voice-menu summary::-webkit-details-marker { display: none; }
.lares-voice-menu-body { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 0; }
.lares-voice-menu-body button { font-size: 12px; }
.lares-voice-original { text-align: start; white-space: pre-wrap; overflow: auto; max-height: 100px; padding: 12px; margin-top: 8px; background: #8881; border-radius: 8px; font-size: 13px; }

.lares-voice-panel { color: var(--q-ink-1, #202124); background: var(--q-background-1, white); inset: auto 0 var(--voice-bottom, 0px); margin: 0 auto; width: min(100vw, 560px); border-radius: 24px 24px 0 0; border-bottom: 0; }
.lares-voice-panel-body { padding: 16px 20px max(16px, env(safe-area-inset-bottom)); }
.lares-voice-panel .lares-voice-primary { background: var(--q-ink-1, var(--color-text-primary, #202124)); color: var(--q-background-1, var(--color-background-primary, white)); border-color: transparent; }
</style>
