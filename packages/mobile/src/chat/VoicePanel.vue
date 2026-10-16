<template>
  <dialog ref="dialog" class="lares-voice-sheet" aria-labelledby="lares-mobile-voice-title" @cancel.prevent="$emit('close')" @click="onBackdrop">
    <div class="lares-voice-sheet__body">
      <header><h2 id="lares-mobile-voice-title">{{ t(`settings.mode.${view.mode}`) }}</h2><button type="button" @click="$emit('close')">{{ t('panel.close') }}</button></header>
      <section>
        <template v-if="!preview">
          <svg class="lares-voice-sheet__wave" viewBox="0 0 120 48" aria-hidden="true"><line v-for="(level, index) in levels" :key="index" :x1="index * 6 + 3" :x2="index * 6 + 3" :y1="24 - Math.max(2, Math.min(22, level * 800))" :y2="24 + Math.max(2, Math.min(22, level * 800))" /></svg>
          <p role="timer" :aria-label="t('panel.elapsed')">{{ elapsed }}s</p>
        </template>
        <p role="status" aria-live="polite">{{ status }}</p>
        <template v-if="view.mode === 'single' && preview">
          <select :aria-label="t('dictation.preset')" :value="view.preset" :disabled="view.busy" @change="selectPreset"><option v-for="id in presets" :key="id" :value="id">{{ t(`dictation.${id}`) }}</option></select>
          <textarea class="lares-voice-sheet__draft" :aria-label="t('panel.draft')" :value="view.draft" :disabled="view.stage === 'processing'" @input="$emit('edit', $event.target.value)" />
          <details><summary>{{ t('dictation.original') }}</summary><p class="original">{{ view.raw }}</p></details>
          <div v-if="view.error"><button type="button" :disabled="view.busy" @click="$emit('preset', view.preset)">{{ t('dictation.retry') }}</button><button type="button" :disabled="view.busy" @click="$emit('preset', 'raw')">{{ t('dictation.useOriginal') }}</button></div>
        </template>
        <div class="lares-voice-sheet__actions">
          <template v-if="view.mode === 'single'">
            <template v-if="preview">
              <button type="button" :disabled="view.busy || !view.draft.trim()" @click="$emit('complete')">{{ t('dictation.insert') }}</button>
              <button type="button" :disabled="view.busy" @click="$emit('discard')">{{ t('dictation.discard') }}</button>
            </template>
            <button v-else type="button" :disabled="view.busy || view.snapshot?.capture !== 'recording' && !view.error && !view.snapshot?.error" @click="$emit(view.snapshot?.capture === 'recording' ? 'finish' : 'start')">{{ t(view.error || view.snapshot?.error ? 'dictation.retry' : 'dictation.finish') }}</button>
          </template>
          <template v-else>
            <button type="button" class="hold" :aria-pressed="view.holding" :disabled="view.busy && !view.holding || view.snapshot?.capture === 'transcribing'"
              @pointerdown="gesture.pointerDown" @pointerup="gesture.pointerUp" @pointercancel="gesture.cancel" @lostpointercapture="gesture.cancel" @keydown="gesture.keyDown" @keyup="gesture.keyUp" @blur="gesture.cancel" @click="accessibleClick">{{ t(view.holding ? 'dictation.release' : 'dictation.hold') }}</button>
            <button type="button" @click="$emit('end')">{{ t('call.end') }}</button>
          </template>
        </div>
      </section>
    </div>
  </dialog>
</template>
<script>
import { DICTATION_PRESETS } from '@olares/lares-core/voice/dictation';
import { createHoldGesture } from '@olares/lares-core/voice/hold';
export default {
  name: 'LaresVoicePanel', props: { view: { type: Object, required: true }, t: { type: Function, required: true } },
  emits: ['close', 'start', 'finish', 'complete', 'discard', 'end', 'hold-start', 'hold-end', 'edit', 'preset'],
  data: () => ({ now: Date.now(), clock: null, previousFocus: null, presets: DICTATION_PRESETS, gesture: null }),
  created() { this.gesture = createHoldGesture({ start: () => this.$emit('hold-start'), end: (cancel) => this.$emit('hold-end', cancel) }); },
  computed: {
    preview() { return ['preview', 'processing'].includes(this.view.stage); },
    levels() { return this.view.levels?.length ? this.view.levels : Array(20).fill(.003); },
    elapsed() { return Math.max(0, Math.floor(((this.view.elapsedMs || 0) + (this.view.startedAt ? this.now - this.view.startedAt : 0)) / 1000)); },
    status() { const state = this.view.snapshot; return this.view.error || state?.error ? this.t(`error.${this.view.error || state.error}`) : this.t(this.view.stage === 'processing' ? 'dictation.processing' : state?.capture === 'transcribing' ? 'mic.transcribing' : state?.capture === 'recording' ? 'call.listening' : this.view.busy ? 'mic.preparing' : state && state.playback !== 'idle' ? 'dictation.speaking' : this.view.mode === 'continuous' ? 'dictation.holdHint' : 'dictation.preview'); },
  },
  watch: { 'view.visible': { immediate: true, handler() { this.$nextTick(this.sync); } } },
  beforeUnmount() { this.gesture.cancel(); clearInterval(this.clock); this.$refs.dialog?.close(); this.previousFocus?.focus?.(); },
  methods: {
    sync() { const dialog = this.$refs.dialog; if (!dialog) return; clearInterval(this.clock); if (this.view.visible) { if (!dialog.open) { this.previousFocus = document.activeElement; dialog.showModal(); } this.clock = setInterval(() => { this.now = Date.now(); }, 250); } else if (dialog.open) { this.gesture.cancel(); dialog.close(); this.previousFocus?.focus?.(); } },
    onBackdrop(event) { if (event.target === this.$refs.dialog) this.$emit('close'); },
    selectPreset(event) { if (!this.view.edited || confirm(this.t('dictation.replaceEdited'))) this.$emit('preset', event.target.value); else event.target.value = this.view.preset; },
    accessibleClick(event) { if (event.detail === 0) this.$emit(this.view.holding ? 'hold-end' : 'hold-start', false); },
  },
};
</script>
<style scoped>
.lares-voice-sheet { color: var(--q-ink-1, #202124); background: var(--q-background-1, white); width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh; margin: 0; border: 0; padding: 0; }
.lares-voice-sheet::backdrop { background: #10182866; }
.lares-voice-sheet__body { padding: max(24px, env(safe-area-inset-top)) 20px max(24px, env(safe-area-inset-bottom)); max-width: 560px; margin: auto; }
header { display: flex; justify-content: space-between; align-items: center; gap: 16px; } h2 { font-size: 22px; }
button { color: inherit; background: transparent; border: 1px solid var(--q-separator, #ddd); border-radius: 14px; padding: 12px 16px; font: inherit; min-height: 44px; cursor: pointer; }
button:focus-visible { outline: 2px solid #3478f6; outline-offset: 2px; } button:disabled { opacity: .45; }
[role=tablist] { display: flex; gap: 8px; margin: 24px 0; } [role=tab] { flex: 1; } [aria-selected=true] { border-color: #3478f6; background: #3478f61a; }
section { text-align: center; } .lares-voice-sheet__device { font-size: 14px; opacity: .65; }
.lares-voice-sheet__wave { width: 160px; height: 64px; margin: 24px auto 0; stroke: #3478f6; stroke-width: 3; stroke-linecap: round; }
.lares-voice-sheet__draft { text-align: start; white-space: pre-wrap; min-height: 100px; max-height: 30dvh; overflow: auto; background: #8881; padding: 16px; border-radius: 12px; }
.lares-voice-sheet__actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 32px; }
textarea { display: block; box-sizing: border-box; width: 100%; font: inherit; color: inherit; border: 1px solid #8884; margin: 16px 0; }
.hold { touch-action: none; user-select: none; background: #3478f6; color: white; min-width: 220px; }
.original { white-space: pre-wrap; text-align: start; }
</style>
