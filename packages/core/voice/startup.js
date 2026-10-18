/** Startup timing contains only a stage and duration, never content or credentials. */
export function recordVoiceStartup(stage, durationMs) {
  const fields = { stage, durationMs: Math.max(0, durationMs) };
  try {
    const clock = globalThis.performance;
    clock?.measure?.(`lares.voice.startup.${stage}`, { start: Math.max(0, clock.now() - fields.durationMs), duration: fields.durationMs, detail: fields });
    globalThis.console?.debug?.("[lares.voice.startup]", fields);
  } catch { /* Observability cannot block recording. */ }
}
