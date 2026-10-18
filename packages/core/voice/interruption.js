/** A suspected acoustic interruption preserves audio until ASR actually settles. */
export function createInterruptionGuard({ output, onState = () => {}, onError = () => {}, now = Date.now, schedule = setTimeout, unschedule = clearTimeout, silenceMs = 2000, limitMs = 10000 }) {
  let candidate = null;
  const clear = () => {
    if (!candidate) return;
    unschedule(candidate.limit); unschedule(candidate.resume);
    candidate = null;
  };
  const valid = run => candidate === run && run.key === output.key?.();
  const stop = code => {
    clear(); void Promise.resolve(output.stop()).catch(() => {});
    onState("idle"); if (code) onError(code);
  };
  return {
    get pending() { return Boolean(candidate); },
    suspect() {
      if (candidate && !valid(candidate)) clear();
      if (candidate) { unschedule(candidate.resume); candidate.empty = false; candidate.endedAt = null; return true; }
      if (typeof output.key?.() !== "string" || output.canPause !== true || output.pause() === false) return false;
      const run = candidate = { key: output.key?.(), limit: null, resume: null, endedAt: null, empty: false };
      run.limit = schedule(() => { if (valid(run)) stop("voice_interruption_timeout"); else if (candidate === run) clear(); }, limitMs);
      onState("confirming"); return true;
    },
    outputEnded() { clear(); },
    speechEnded() { if (candidate) candidate.endedAt = now(); },
    final(text) {
      const run = candidate;
      if (!run) return;
      if (!valid(run)) { if (candidate === run) clear(); return; }
      if (text.trim()) { stop(); return; }
      run.empty = true;
      if (run.endedAt == null) run.endedAt = now();
      unschedule(run.resume);
      run.resume = schedule(() => {
        if (!valid(run) || !run.empty) { if (candidate === run) clear(); return; }
        clear();
        try { Promise.resolve(output.resume()).catch(() => { if (output.key?.() === run.key) stop("voice_playback_failed"); }); onState("playing"); }
        catch { stop("voice_playback_failed"); }
      }, Math.max(0, silenceMs - (now() - run.endedAt)));
    },
    fail(code) { if (candidate) stop(code); },
    cancel() { clear(); },
  };
}
