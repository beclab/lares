<template>
  <div class="lares-inline-voice" :data-phase="ui.phase" @keydown="onKey" @pointerdown.capture="gesture.additionalPointer">
    <span v-if="view.holding" class="lares-inline-cancel" :data-armed="view.cancelArmed" aria-hidden="true">{{ t(view.cancelArmed ? 'gesture.cancelRelease' : 'gesture.slideCancel') }}</span>
    <button ref="main" type="button" class="lares-inline-main" :disabled="ui.disabled" :aria-pressed="view.mode === 'continuous' ? view.holding : undefined" :aria-label="t(ui.label)"
      @pointerdown="down" @pointermove="gesture.pointerMove" @pointerup="gesture.pointerUp" @pointercancel="gesture.cancel" @lostpointercapture="gesture.cancel" @keydown="keyDown" @keyup="keyUp" @blur="gesture.cancel" @click="click">
      <svg v-if="view.mode === 'single' && ui.recording && levels.length" class="lares-inline-level" viewBox="0 0 32 24" aria-hidden="true"><line v-for="(level, index) in levels" :key="index" :x1="index * 5 + 3" :x2="index * 5 + 3" :y1="12 - Math.max(2, Math.min(10, level * 500))" :y2="12 + Math.max(2, Math.min(10, level * 500))" /></svg>
      <span>{{ t(ui.label) }}</span><span v-if="ui.timed" class="lares-inline-time" aria-hidden="true"> · {{ ui.elapsed }}</span>
    </button>
    <span v-if="!ui.error" class="lares-inline-status" :data-visible="['speaking', 'working'].includes(ui.phase)" role="status" aria-live="polite" aria-atomic="true">{{ status }}</span>
  </div>
</template>
<script>
import { createHoldGesture } from '@olares/lares-core/voice/hold';
import { voiceInputPresentation } from '@olares/lares-core/voice/presentation';
import { messageFromCode } from '@olares/lares-core/i18n/t';
export default {
  name: 'LaresVoiceInput', props: { view: { type: Object, required: true }, t: { type: Function, required: true } }, emits: ['action'],
  data: () => ({ now: Date.now(), clock: null, gesture: null }),
  computed: {
    ui() { return voiceInputPresentation(this.view, this.now); },
    levels() { return (this.view.levels || []).slice(-6); },
    status() { return this.ui.error ? messageFromCode(this.t, this.ui.error, 'error.voice_failed') : this.t(this.ui.status); },
  },
  created() { this.gesture = createHoldGesture({ start: () => this.action('holdStart'), end: value => this.action('holdEnd', value), onCancelChange: value => this.action('setCancelArmed', value), isActive: () => this.view.holding }); },
  mounted() { this.$refs.main?.focus(); this.clock = setInterval(() => { this.now = Date.now(); }, 250); window.addEventListener('blur', this.cancel); window.addEventListener('pointerdown', this.additionalPointer, true); },
  beforeUnmount() { this.gesture.cancel(); clearInterval(this.clock); window.removeEventListener('blur', this.cancel); window.removeEventListener('pointerdown', this.additionalPointer, true); },
  methods: {
    action(action, value) { this.$emit('action', { action, value }); },
    down(event) { if (this.view.mode === 'continuous') this.gesture.pointerDown(event); },
    keyDown(event) { if (this.view.mode === 'continuous') { this.gesture.keyDown(event); if (['Space', 'Enter'].includes(event.code)) event.stopPropagation(); } },
    keyUp(event) { if (this.view.mode === 'continuous') this.gesture.keyUp(event); },
    click(event) { if (this.view.mode === 'single') this.action(this.ui.error ? 'start' : 'finish'); else if (event.detail === 0) this.gesture.activate(); },
    onKey(event) { if (event.key !== 'Escape') return; event.preventDefault(); event.stopPropagation(); if (!event.repeat && !this.gesture.escape()) this.action('close'); },
    cancel() { this.gesture.cancel(); }, additionalPointer(event) { this.gesture.additionalPointer(event); },
  },
};
</script>
<style scoped>
.lares-inline-voice { position: relative; flex: 1; min-width: 0; display: flex; align-items: center; min-height: 40px; }
.lares-inline-main { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 40px; padding: 6px 0; border: 0; background: transparent; color: inherit; font: inherit; font-size: 16px; font-weight: 600; touch-action: none; user-select: none; -webkit-touch-callout: none; cursor: pointer; }
.lares-inline-main:focus-visible { outline: 2px solid var(--q-blue-default, #3377ff); outline-offset: 2px; border-radius: 8px; }
.lares-inline-time { font-variant-numeric: tabular-nums; white-space: pre; }
.lares-inline-level { width: 28px; height: 24px; margin-right: 8px; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
.lares-inline-cancel { position: absolute; bottom: calc(100% + 18px); left: 50%; transform: translateX(-50%); white-space: nowrap; font-size: 13px; padding: 7px 12px; border-radius: 10px; background: var(--q-background-1, white); box-shadow: 0 2px 12px #0001; pointer-events: none; }
[data-phase=recording] .lares-inline-main { color: var(--q-blue-default, #3377ff); }
[data-phase=cancel] .lares-inline-main, .lares-inline-cancel[data-armed=true] { color: var(--q-red-default, #c23d32); }
.lares-inline-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.lares-inline-status[data-visible=true] { width: auto; height: auto; clip-path: none; bottom: calc(100% + 16px); background: var(--q-background-1, white); padding: 6px; font-size: 12px; color: var(--q-ink-2, #777); }
</style>
