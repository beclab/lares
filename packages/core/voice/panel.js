import { DICTATION_PRESETS } from "./dictation.js";

/** The panel owns drafts and turn policy; adapters only supply settings, audio and insertion ports. */
export function createVoicePanel({ create, complete, loadConfig = async () => ({}), process = async ({ text }) => text, onSession = () => {} }) {
  let state = { visible: false, inputActive: false, previewVisible: false, mode: "single", sessionId: null, raw: "", draft: "", edited: false, preset: "clean", stage: "idle", snapshot: null, busy: false, error: null, device: "", levels: [], startedAt: null, elapsedMs: 0, holding: false, cancelArmed: false };
  let call = null, config = null, generation = 0, intent = 0, processing = null;
  let unsubscribe = () => {};
  let serial = Promise.resolve();
  const drafts = new Map(), listeners = new Set();
  const emit = (patch) => { state = { ...state, ...patch }; state.previewVisible = state.visible && state.mode === "single" && (state.stage === "preview" || state.stage === "processing" && state.previewVisible); state.inputActive = state.visible && !state.previewVisible; for (const listener of listeners) listener(); };
  const save = () => state.mode === "single" && drafts.set(state.sessionId, { raw: state.raw, draft: state.draft, edited: state.edited, preset: state.preset, config });
  const cancelProcessing = () => { processing?.abort(); processing = null; };
  const enqueue = (operation) => {
    const result = serial.catch(() => {}).then(async () => { emit({ busy: true, error: null }); try { return await operation(); } catch (error) { emit({ error: error.code || error.message, holding: false, cancelArmed: false }); throw error; } finally { emit({ busy: false }); } });
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
    generation++; unsubscribe(); unsubscribe = () => {};
    const previous = call; call = null;
    try { await previous?.stop(); } finally { emit({ snapshot: null, startedAt: null, elapsedMs: 0, levels: [] }); }
  };
  const renderDraft = () => { emit({ stage: state.raw ? "preview" : "idle" }); save(); };
  const transform = async (preset) => {
    if (!DICTATION_PRESETS.includes(preset)) throw new Error("voice_config_invalid");
    cancelProcessing(); const abort = processing = new AbortController(); const token = generation;
    emit({ preset, stage: "processing", error: null });
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(45_000)]);
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
  const prepare = async (token) => {
    if (call?.controller.getSnapshot().connection === "paused") { await call.resume({ shouldResume: () => token === intent && state.visible }); return; }
    if (call?.controller.getSnapshot().connection === "open") return;
    await end(); config = state.mode === "single" && config ? config : structuredClone(await loadConfig());
    if (token !== intent || !state.visible) return;
    const target = state.sessionId, epoch = ++generation;
    const conversation = await create({ mode: state.mode, sessionId: target, config,
      onTranscript({ text }) {
        if (epoch !== generation) return;
        const raw = [state.raw, text].filter(Boolean).join(" "); emit({ raw, draft: raw, edited: false }); save();
      }, onDevice(device) { if (epoch === generation) emit({ device }); },
    });
    if (token !== intent || !state.visible) { await conversation.stop(); return; }
    call = conversation;
    unsubscribe = call.controller.subscribe(() => {
      if (epoch !== generation) return;
      const snapshot = call.controller.getSnapshot();
      if (!state.sessionId && snapshot.sessionId) { emit({ sessionId: snapshot.sessionId }); onSession(snapshot.sessionId); }
      emit({ snapshot, ...(snapshot.inputLevel == null ? {} : { levels: [...state.levels.slice(-19), snapshot.inputLevel] }),
        ...(snapshot.capture === "recording" && state.snapshot?.capture !== "recording" ? { startedAt: Date.now(), elapsedMs: 0 } : snapshot.capture !== "recording" && state.startedAt ? { startedAt: null, elapsedMs: Date.now() - state.startedAt } : {}) });
    });
    await call.start({ sessionId: target, continuous: state.mode === "continuous", manual: state.mode === "continuous", shouldStart: () => token === intent && state.visible });
    if (token !== intent || !state.visible) await call.controller.cancelRecording();
  };
  const pause = async () => {
    try { if (state.mode === "single") { await finishCapture(); renderDraft(); } else await call?.controller.cancelRecording(); }
    finally { if (call?.controller.getSnapshot().connection === "open") await call.pause(); }
  };
  const panel = {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    get conversation() { return call; },
    open({ mode = state.mode, sessionId = state.sessionId, preset } = {}) {
      const token = ++intent; emit({ visible: true });
      return enqueue(async () => {
        if (sessionId !== state.sessionId || mode !== state.mode) {
          try { await pause(); } finally { await end(); save(); const held = drafts.get(sessionId); config = held?.config || null; emit({ sessionId, mode, raw: mode === "single" ? held?.raw || "" : "", draft: mode === "single" ? held?.draft || "" : "", edited: mode === "single" && (held?.edited || false), preset: held?.preset || "clean", stage: mode === "single" && held?.raw ? "preview" : "idle" }); }
        }
        if (mode === "single" && !state.raw && token === intent && state.visible) {
          config = structuredClone(await loadConfig());
          emit({ preset: preset || config.dictationPreset || "clean" });
          await prepare(token); if (token === intent && state.visible) emit({ stage: "recording" });
        }
      });
    },
    bind(sessionId) {
      if (sessionId === state.sessionId) return Promise.resolve();
      intent++; cancelProcessing(); emit({ visible: false, holding: false, cancelArmed: false });
      if (state.mode === "continuous") void call?.controller.cancelRecording();
      return enqueue(async () => { try { await pause(); } finally { await end(); save(); const held = drafts.get(sessionId); config = held?.config || null; emit({ sessionId, raw: held?.raw || "", draft: held?.draft || "", edited: held?.edited || false, preset: held?.preset || "clean", stage: held?.raw ? "preview" : "idle" }); } });
    },
    close() { intent++; cancelProcessing(); emit({ visible: false, holding: false, cancelArmed: false }); if (state.mode === "continuous") void call?.controller.cancelRecording(); return enqueue(pause); },
    pause() { intent++; cancelProcessing(); emit({ holding: false, cancelArmed: false }); if (state.mode === "continuous") void call?.controller.cancelRecording(); return enqueue(pause); },
    start() { const token = ++intent; return enqueue(() => prepare(token)); },
    finish: () => state.busy ? Promise.resolve() : enqueue(async () => { await finishCapture(); if (state.raw) await transform(state.preset); else renderDraft(); }),
    edit(text) { cancelProcessing(); emit({ draft: text, edited: true, stage: "preview" }); save(); },
    selectPreset(preset, replaceEdited = false) {
      if (state.edited && !replaceEdited) return Promise.resolve(false);
      return enqueue(async () => { await transform(preset); return true; });
    },
    holdStart() {
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
    complete() { return enqueue(async () => {
      if (!state.draft || state.stage !== "preview") return;
      await complete({ sessionId: state.sessionId, text: state.draft });
      drafts.delete(state.sessionId); config = null; emit({ raw: "", draft: "", edited: false, stage: "idle", visible: false }); await end();
    }); },
    discard() { intent++; cancelProcessing(); return enqueue(async () => { await end(); drafts.delete(state.sessionId); config = null; emit({ raw: "", draft: "", edited: false, stage: "idle", visible: false }); }); },
    end() { intent++; emit({ holding: false, cancelArmed: false }); return enqueue(async () => { await end(); emit({ visible: false }); }); },
    dispose() { intent++; cancelProcessing(); return enqueue(async () => { try { await end(); } finally { listeners.clear(); drafts.clear(); } }); },
  };
  return panel;
}
