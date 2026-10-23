import { setVoiceActivity } from "./activity.js";
import { DICTATION_PRESETS } from "./dictation.js";

/** Some mobile webviews lack AbortSignal.any/timeout; the caller signal still cancels. */
function budgetedSignal(signal, ms) {
  const signals = [signal];
  if (typeof AbortSignal?.timeout === "function") {
    try { signals.push(AbortSignal.timeout(ms)); } catch { /* caller signal only */ }
  }
  if (signals.length > 1 && typeof AbortSignal.any === "function") {
    try { return AbortSignal.any(signals); } catch { /* caller signal only */ }
  }
  return signal;
}

/** The panel owns drafts and turn policy; adapters only supply settings, audio and insertion ports. */
export function createVoicePanel({ create, complete, loadConfig = async () => ({}), process = async ({ text }) => text, onSession = () => {}, manualTurns = true, inlineDictation = false, prepareInput = () => null, armOutput = () => {} }) {
  let state = { visible: false, inputActive: false, previewVisible: false, mode: "single", sessionId: null, raw: "", draft: "", edited: false, preset: "raw", stage: "idle", snapshot: null, busy: false, error: null, readAloudError: null, device: "", levels: [], startedAt: null, elapsedMs: 0, holding: false, cancelArmed: false };
  let call = null, config = null, generation = 0, intent = 0, processing = null;
  let inputPreparation = null;
  let readAloudPreference, appliedReadAloud, readAloudPending = null, readAloudReady = false, outputRevision = 0;
  const cancelPreparation = () => { inputPreparation?.cancel(); inputPreparation = null; };
  let unsubscribe = () => {};
  let serial = Promise.resolve();
  const drafts = new Map(), listeners = new Set();
  const emit = (patch) => { state = { ...state, ...patch }; state.previewVisible = !inlineDictation && state.visible && state.mode === "single" && (state.stage === "preview" || state.stage === "processing" && state.previewVisible); state.inputActive = state.visible && !state.previewVisible; setVoiceActivity(listeners, state.visible && (state.busy || state.snapshot?.capture === "recording" || state.snapshot?.capture === "transcribing" || state.snapshot?.connection === "open")); for (const listener of listeners) listener(); };
  const save = () => state.mode === "single" && drafts.set(state.sessionId, { raw: state.raw, draft: state.draft, edited: state.edited, preset: state.preset, config });
  const cancelProcessing = () => { processing?.abort(); processing = null; };
  const enqueue = (operation) => {
    const result = serial.catch(() => {}).then(async () => { emit({ busy: true, error: null }); try { return await operation(); } catch (error) { cancelPreparation(); emit({ error: error.code || error.message, holding: false, cancelArmed: false }); throw error; } finally { emit({ busy: false }); } });
    serial = result; return result;
  };
  const finishCapture = async () => {
    const controller = call?.controller;
    if (!controller || !["recording", "transcribing"].includes(controller.getSnapshot().capture)) return;
    if (controller.getSnapshot().capture === "recording" && controller.getSnapshot().inputReady === false) { await controller.cancelRecording(); return; }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); void controller.cancelRecording(); reject(new Error("voice_recognition_timeout")); }, 45000);
      const check = () => { if (controller.getSnapshot().capture === "idle") { clearTimeout(timer); off(); const error = controller.getSnapshot().error; error ? reject(new Error(error)) : resolve(); } };
      const off = controller.subscribe(check);
      Promise.resolve(controller.stopRecording()).catch((error) => { clearTimeout(timer); off(); reject(error); }); check();
    });
  };
  const end = async () => {
    generation++; outputRevision++; readAloudReady = false; appliedReadAloud = undefined; readAloudPending = null; unsubscribe(); unsubscribe = () => {};
    const previous = call; call = null;
    try { await previous?.stop(); } finally { emit({ snapshot: null, readAloudError: null, startedAt: null, elapsedMs: 0, levels: [] }); }
  };
  const renderDraft = () => { emit({ stage: state.raw ? "preview" : "idle" }); save(); };
  const transform = async (preset) => {
    if (!DICTATION_PRESETS.includes(preset)) throw new Error("voice_config_invalid");
    cancelProcessing(); const abort = processing = new AbortController(); const token = generation;
    emit({ preset, stage: "processing", error: null });
    const signal = budgetedSignal(abort.signal, 45_000);
    let interrupted;
    const cancellation = new Promise((_, reject) => { interrupted = () => reject(signal.reason); signal.addEventListener("abort", interrupted, { once: true }); });
    try {
      const text = preset === "raw" ? state.raw : await Promise.race([process({ text: state.raw, preset, config, signal }), cancellation]);
      if (abort.signal.aborted || token !== generation) return;
      if (typeof text !== "string" || !text.trim()) throw new Error("voice_cleanup_failed");
      emit({ draft: text, edited: false });
    } catch (error) {
      if (abort.signal.aborted || token !== generation) return;
      emit({ error: error.code || error.message, draft: state.draft || state.raw });
    } finally {
      signal.removeEventListener("abort", interrupted);
      if (processing === abort) { processing = null; renderDraft(); }
    }
  };
  const readoutWanted = async () => {
    if (readAloudPreference === true) return true;
    if (readAloudPreference === false) return false;
    return (await loadConfig())?.speak === true;
  };
  const prepare = async (token, { readout = false } = {}) => {
    const armed = () => token === intent && (readout || state.visible);
    if (readout && !await readoutWanted()) return;
    if (call?.controller.getSnapshot().connection === "paused") {
      await call.resume({ shouldResume: armed, ...(readout ? { resumeListening: false } : {}) });
      if (armed() && readout) await panel.setReadAloud(true);
      else if (armed() && state.mode === "continuous" && typeof readAloudPreference === "boolean") await panel.setReadAloud(readAloudPreference);
      return;
    }
    if (call?.controller.getSnapshot().connection === "open") {
      if (readout && readAloudPreference === true) await panel.setReadAloud(true);
      return;
    }
    await end(); config = state.mode === "single" && config ? config : structuredClone(await loadConfig());
    if (!armed()) return;
    if (state.mode === "continuous" && typeof readAloudPreference === "boolean") config = { ...config, speak: readAloudPreference };
    if (readout && config.speak !== true) return;
    const initialReadAloud = state.mode === "continuous" && config.speak === true;
    const target = state.sessionId, epoch = ++generation;
    const conversation = await create({ mode: state.mode, sessionId: target, config, preparation: inputPreparation,
      onTranscript({ text }) {
        if (epoch !== generation) return;
        const raw = [state.raw, text].filter(Boolean).join(" "); emit({ raw, draft: raw, edited: false }); save();
      }, onDevice(device) { if (epoch === generation) emit({ device }); },
    });
    if (!armed()) { await conversation.stop(); return; }
    call = conversation; appliedReadAloud = initialReadAloud;
    unsubscribe = call.controller.subscribe(() => {
      if (epoch !== generation) return;
      const snapshot = call.controller.getSnapshot();
      if (!state.sessionId && snapshot.sessionId) { emit({ sessionId: snapshot.sessionId }); onSession(snapshot.sessionId); }
      emit({ snapshot, ...(snapshot.inputLevel == null ? {} : { levels: [...state.levels.slice(-19), snapshot.inputLevel] }),
        ...(snapshot.capture === "recording" && snapshot.inputReady && !state.startedAt ? { startedAt: Date.now(), elapsedMs: 0 } : snapshot.capture !== "recording" && state.startedAt ? { startedAt: null, elapsedMs: Date.now() - state.startedAt } : {}) });
    });
    await call.start({ sessionId: target, continuous: state.mode === "continuous", manual: state.mode === "continuous" && (manualTurns || readout), shouldStart: armed });
    if (!armed()) await call.controller.cancelRecording();
    else {
      readAloudReady = true;
      if (readout) await panel.setReadAloud(true);
      else if (state.mode === "continuous" && typeof readAloudPreference === "boolean") await panel.setReadAloud(readAloudPreference);
    }
  };
  const pause = async () => {
    try { if (state.mode === "single") { await finishCapture(); renderDraft(); } else await call?.controller.cancelRecording(); }
    finally {
      if (call?.controller.getSnapshot().connection === "open") await call.pause();
      // The banner belongs to the open call. Leaving it must not keep a mute/sync notice on the chat.
      if (!state.visible) { outputRevision++; emit({ readAloudError: null }); }
    }
  };
  const insertDraft = async () => {
    if (!state.draft || state.stage !== "preview") return;
    await complete({ sessionId: state.sessionId, text: state.draft });
    drafts.delete(state.sessionId); config = null;
    emit({ raw: "", draft: "", edited: false, stage: "idle", visible: false }); await end();
  };
  const panel = {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    get conversation() { return call; },
    setReadAloud(value) {
      const next = readAloudPreference = value === true;
      if (config) config = { ...config, speak: next };
      const target = call, epoch = generation;
      if (!readAloudReady || !target?.setReadAloud || state.mode !== "continuous") return Promise.resolve(true);
      if (readAloudPending?.target === target && readAloudPending.value === next) return readAloudPending.promise;
      if (!readAloudPending && appliedReadAloud === next && !state.readAloudError) return Promise.resolve(true);
      const revision = ++outputRevision;
      const current = () => target === call && epoch === generation && revision === outputRevision;
      // Phone playback is local. Asking for silence already stopped it, so a missed
      // server ack is not a readout failure. A headset can keep playing until the host agrees.
      const localSilence = next !== true && state.device !== "headset";
      if (localSilence) emit({ readAloudError: null });
      const pending = { target, value: next, promise: null };
      pending.promise = Promise.resolve().then(() => {
        if (target !== call || epoch !== generation) return;
        return target.setReadAloud(next);
      }).then(() => {
        if (current()) { appliedReadAloud = next; emit({ readAloudError: null }); }
        return true;
      }, error => {
        if (!current()) return false;
        if (localSilence) { appliedReadAloud = false; emit({ readAloudError: null }); return true; }
        emit({ readAloudError: error.code || error.message || "voice_failed" });
        return false;
      }).finally(() => { if (readAloudPending === pending) readAloudPending = null; });
      readAloudPending = pending;
      return pending.promise;
    },
    retryReadAloud() { armOutput(); return panel.setReadAloud(readAloudPreference); },
    arm() { armOutput(); },
    open({ mode = state.mode, sessionId = state.sessionId, preset, configSnapshot } = {}) {
      armOutput();
      if (state.busy) return Promise.resolve();
      cancelPreparation();
      const snapshot = configSnapshot ? structuredClone(configSnapshot) : null;
      if (mode === "single" && snapshot && !(sessionId === state.sessionId ? state.raw : drafts.get(sessionId)?.raw)) inputPreparation = prepareInput(snapshot);
      const token = ++intent; emit({ visible: true });
      return enqueue(async () => {
        if (sessionId !== state.sessionId || mode !== state.mode) {
          try { await pause(); } finally { await end(); save(); const held = drafts.get(sessionId); config = held?.config || null; emit({ sessionId, mode, raw: mode === "single" ? held?.raw || "" : "", draft: mode === "single" ? held?.draft || "" : "", edited: mode === "single" && (held?.edited || false), preset: held?.preset || "raw", stage: mode === "single" && held?.raw ? "preview" : "idle" }); }
        }
        if (mode === "single" && !state.raw && token === intent && state.visible) {
          config = snapshot || structuredClone(await loadConfig());
          emit({ preset: preset || config.dictationPreset || "raw" });
          await prepare(token); if (token === intent && state.visible) emit({ stage: "recording" });
        }
      });
    },
    bind(sessionId) {
      if (sessionId === state.sessionId) return Promise.resolve();
      intent++; cancelPreparation(); cancelProcessing(); emit({ visible: false, holding: false, cancelArmed: false });
      if (state.mode === "continuous") void call?.controller.cancelRecording();
      return enqueue(async () => { try { await pause(); } finally { await end(); save(); const held = drafts.get(sessionId); config = held?.config || null; emit({ sessionId, raw: held?.raw || "", draft: held?.draft || "", edited: held?.edited || false, preset: held?.preset || "raw", stage: held?.raw ? "preview" : "idle" }); } });
    },
    close() { intent++; cancelPreparation(); cancelProcessing(); emit({ visible: false, holding: false, cancelArmed: false }); if (state.mode === "continuous") void call?.controller.cancelRecording(); return enqueue(pause); },
    pause() { intent++; cancelPreparation(); cancelProcessing(); emit({ holding: false, cancelArmed: false }); if (state.mode === "continuous") void call?.controller.cancelRecording(); return enqueue(pause); },
    start() { armOutput(); const token = ++intent; return enqueue(() => prepare(token)); },
    openReadout() {
      if (state.mode !== "continuous") return Promise.resolve();
      armOutput();
      const token = ++intent;
      return enqueue(() => prepare(token, { readout: true }));
    },
    finish() {
      if (state.busy) return Promise.resolve();
      const token = intent;
      return enqueue(async () => {
        await finishCapture();
        if (token !== intent) return;
        if (state.raw) await transform(state.preset); else renderDraft();
        if (inlineDictation && token === intent && state.visible && state.draft && !state.error) await insertDraft();
      });
    },
    edit(text) { cancelProcessing(); emit({ draft: text, edited: true, stage: "preview" }); save(); },
    selectPreset(preset, replaceEdited = false) {
      if (state.edited && !replaceEdited) return Promise.resolve(false);
      if (preset === "raw" && state.raw && state.stage === "processing") {
        intent++; cancelProcessing();
      }
      return enqueue(async () => { await transform(preset); return true; });
    },
    holdStart() {
      armOutput();
      if (state.busy || state.holding || state.snapshot?.capture === "transcribing") return Promise.resolve();
      const token = ++intent; emit({ holding: true, cancelArmed: false });
      return enqueue(async () => {
        await prepare(token);
        if (token !== intent || !state.holding || !state.visible) return;
        await call?.controller.stopPlayback();
        if (token === intent && state.holding) void call?.controller.listen();
      });
    },
    setCancelArmed(value) { emit({ cancelArmed: state.holding && value === true }); },
    holdEnd(cancel = state.cancelArmed) {
      intent++; emit({ holding: false, cancelArmed: false });
      if (!call) return Promise.resolve();
      return Promise.resolve(cancel || !call.controller.getSnapshot().inputReady ? call.controller.cancelRecording() : call.controller.stopRecording());
    },
    complete() { return enqueue(insertDraft); },
    discard() { intent++; cancelPreparation(); cancelProcessing(); void call?.controller.cancelRecording().catch(() => {}); return enqueue(async () => { await end(); drafts.delete(state.sessionId); config = null; emit({ raw: "", draft: "", edited: false, stage: "idle", visible: false }); }); },
    end() { intent++; cancelPreparation(); emit({ visible: false, holding: false, cancelArmed: false }); return enqueue(async () => { await end(); emit({ visible: false }); }); },
    dispose() { intent++; cancelPreparation(); cancelProcessing(); return enqueue(async () => { try { await end(); } finally { setVoiceActivity(listeners, false); listeners.clear(); drafts.clear(); } }); },
  };
  return panel;
}
