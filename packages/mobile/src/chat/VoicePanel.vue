<template>
  <dialog ref="dialog" class="lares-voice-sheet" aria-labelledby="lares-mobile-voice-title" @cancel.prevent="$emit('close')" @click="onBackdrop">
    <div class="lares-voice-sheet__body">
      <header><h2 id="lares-mobile-voice-title">{{ t('panel.title') }}</h2><button type="button" @click="$emit('close')">{{ t('panel.close') }}</button></header>
      <div role="tablist" :aria-label="t('settings.mode')" @keydown="onTabKey">
        <button v-for="mode in ['single', 'continuous']" :id="`mobile-voice-${mode}`" :key="mode" type="button" role="tab" :aria-selected="view.mode === mode" :tabindex="view.mode === mode ? 0 : -1" aria-controls="lares-mobile-voice-content" :disabled="view.busy" @click="$emit('mode', mode)">{{ t(`settings.mode.${mode}`) }}</button>
      </div>
      <section id="lares-mobile-voice-content" role="tabpanel" :aria-labelledby="`mobile-voice-${view.mode}`">
        <p class="lares-voice-sheet__device">{{ t(!view.device ? 'settings.device.auto' : view.device === 'headset' ? 'settings.device.headset' : 'settings.device.device') }}</p>
        <svg class="lares-voice-sheet__wave" viewBox="0 0 120 48" aria-hidden="true"><line v-for="(level, index) in levels" :key="index" :x1="index * 6 + 3" :x2="index * 6 + 3" :y1="24 - Math.max(2, Math.min(22, level * 800))" :y2="24 + Math.max(2, Math.min(22, level * 800))" /></svg>
        <p role="timer" :aria-label="t('panel.elapsed')">{{ elapsed }}s</p>
        <p role="status" aria-live="polite">{{ status }}</p>
        <div v-if="view.mode === 'single'" class="lares-voice-sheet__draft" :aria-label="t('panel.draft')" aria-live="polite">{{ view.draft || t('panel.draftHint') }}</div>
        <p v-else>{{ t('panel.messages') }}</p>
        <div class="lares-voice-sheet__actions">
          <button v-if="!active" type="button" :disabled="view.busy" @click="$emit('start')">{{ t(view.snapshot?.connection === 'paused' ? 'panel.continue' : 'panel.start') }}</button>
          <button v-else type="button" :disabled="view.busy" @click="$emit('pause')">{{ t('panel.pause') }}</button>
          <template v-if="view.mode === 'single'">
            <button type="button" :disabled="view.busy || (!view.draft && view.snapshot?.capture !== 'recording')" @click="$emit('complete')">{{ t('panel.complete') }}</button>
            <button type="button" :disabled="view.busy" @click="$emit('discard')">{{ t('panel.discard') }}</button>
          </template>
          <template v-if="active && view.mode === 'continuous'">
            <button type="button" :disabled="view.busy" @click="$emit('action', 'mute')">{{ t(view.snapshot.outputMuted ? 'call.unmute' : 'call.mute') }}</button>
            <button type="button" :disabled="view.busy" @click="$emit('action', 'input')">{{ t(view.snapshot.inputPaused ? 'call.resumeInput' : 'call.pauseInput') }}</button>
          </template>
          <button v-if="view.snapshot && view.snapshot.playback !== 'idle'" type="button" :disabled="view.busy" @click="$emit('action', 'playback')">{{ t('call.stopPlayback') }}</button>
          <button v-if="view.snapshot" type="button" :disabled="view.busy" @click="$emit('end')">{{ t('call.end') }}</button>
        </div>
      </section>
    </div>
  </dialog>
</template>
<script>
export default {
  name: 'LaresVoicePanel', props: { view: { type: Object, required: true }, t: { type: Function, required: true } },
  emits: ['close', 'mode', 'start', 'pause', 'complete', 'discard', 'end', 'action'],
  data: () => ({ now: Date.now(), clock: null, previousFocus: null }),
  computed: {
    active() { return this.view.snapshot?.connection === 'open'; },
    levels() { return this.view.levels?.length ? this.view.levels : Array(20).fill(.003); },
    elapsed() { return Math.max(0, Math.floor(((this.view.elapsedMs || 0) + (this.view.startedAt ? this.now - this.view.startedAt : 0)) / 1000)); },
    status() { const state = this.view.snapshot; return this.view.error || state?.error ? this.t(`error.${this.view.error || state.error}`) : this.t(this.view.busy ? 'mic.preparing' : !this.active ? 'panel.paused' : state.capture === 'transcribing' ? 'mic.transcribing' : state.capture === 'recording' ? 'call.listening' : state.playback !== 'idle' ? 'call.halfDuplex' : 'call.waiting'); },
  },
  watch: { 'view.visible': { immediate: true, handler() { this.$nextTick(this.sync); } } },
  beforeUnmount() { clearInterval(this.clock); this.$refs.dialog?.close(); this.previousFocus?.focus?.(); },
  methods: {
    sync() { const dialog = this.$refs.dialog; if (!dialog) return; clearInterval(this.clock); if (this.view.visible) { if (!dialog.open) { this.previousFocus = document.activeElement; dialog.showModal(); } this.clock = setInterval(() => { this.now = Date.now(); }, 250); } else if (dialog.open) { dialog.close(); this.previousFocus?.focus?.(); } },
    onBackdrop(event) { if (event.target === this.$refs.dialog) this.$emit('close'); },
    onTabKey(event) { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const mode = event.key === 'Home' ? 'single' : event.key === 'End' ? 'continuous' : this.view.mode === 'single' ? 'continuous' : 'single'; this.$emit('mode', mode); this.$refs.dialog.querySelector(`#mobile-voice-${mode}`)?.focus(); },
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
</style>
