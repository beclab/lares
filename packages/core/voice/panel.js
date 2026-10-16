/** Framework-independent panel lifetime; factories only supply audio/platform ports. */
export function createVoicePanel({ create, complete, onSession = () => {} }) {
  let state = { visible: false, mode: "single", sessionId: null, draft: "", snapshot: null, busy: false, error: null, device: "", levels: [], startedAt: null };
  let call = null;
  let unsubscribe = () => {};
  let serial = Promise.resolve();
  let generation = 0;
  const drafts = new Map();
  const listeners = new Set();
  const emit = (patch) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const enqueue = (operation) => {
    const result = serial.catch(() => {}).then(async () => { emit({ busy: true, error: null }); try { return await operation(); } catch (error) { emit({ error: error.code || error.message }); throw error; } finally { emit({ busy: false }); } });
    serial = result; return result;
  };
  const finishCapture = async () => {
    if (!call || state.mode !== "single") return;
    const controller = call.controller;
    if (!["recording", "transcribing"].includes(controller.getSnapshot().capture)) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error("voice_recognition_timeout")); }, 45000);
      const check = () => { if (controller.getSnapshot().capture === "idle") { clearTimeout(timer); off(); resolve(); } };
      const off = controller.subscribe(check);
      controller.stopRecording(); check();
    });
  };
  const pause = async () => { await finishCapture(); if (call?.controller.getSnapshot().connection === "open") await call.pause(); };
  const end = async () => { generation++; unsubscribe(); unsubscribe = () => {}; const previous = call; call = null; await previous?.stop(); emit({ snapshot: null, startedAt: null, levels: [] }); };
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    get conversation() { return call; },
    open({ mode = state.mode, sessionId = state.sessionId } = {}) {
      emit({ visible: true });
      return enqueue(async () => {
        if (sessionId !== state.sessionId) { await pause(); await end(); emit({ sessionId, draft: drafts.get(sessionId) || "" }); }
        if (mode !== state.mode) { await pause(); await end(); emit({ mode }); }
      });
    },
    bind(sessionId) {
      if (sessionId === state.sessionId) return Promise.resolve();
      return enqueue(async () => { await pause(); await end(); emit({ sessionId, draft: drafts.get(sessionId) || "" }); });
    },
    close() { emit({ visible: false }); return enqueue(pause); },
    pause: () => enqueue(pause),
    start() { return enqueue(async () => {
      if (call?.controller.getSnapshot().connection === "paused") { await call.resume(); return; }
      if (call?.controller.getSnapshot().connection === "open") return;
      await end();
      const target = state.sessionId; const token = ++generation;
      const conversation = await create({ mode: state.mode, sessionId: target,
        onTranscript({ text }) {
          if (token !== generation) return;
          const next = [drafts.get(target), text].filter(Boolean).join(" ");
          drafts.set(target, next);
          if (state.sessionId === target) emit({ draft: next });
        },
        onDevice(device) { if (token === generation) emit({ device }); },
      });
      call = conversation;
      unsubscribe = call.controller.subscribe(() => {
        if (token !== generation) return;
        const snapshot = call.controller.getSnapshot();
        if (!state.sessionId && snapshot.sessionId) { emit({ sessionId: snapshot.sessionId }); onSession(snapshot.sessionId); }
        emit({ snapshot, ...(snapshot.inputLevel == null ? {} : { levels: [...state.levels.slice(-19), snapshot.inputLevel] }),
          ...(snapshot.capture === "recording" && state.snapshot?.capture !== "recording" ? { startedAt: Date.now() } : {}) });
      });
      await call.start({ sessionId: target, continuous: state.mode === "continuous" });
    }); },
    complete() { return enqueue(async () => {
      await finishCapture();
      const text = state.draft;
      if (!text) return;
      await complete({ sessionId: state.sessionId, text });
      drafts.delete(state.sessionId); emit({ draft: "", visible: false }); await end();
    }); },
    discard() { return enqueue(async () => { await end(); drafts.delete(state.sessionId); emit({ draft: "" }); }); },
    end: () => enqueue(end),
    action(action) { return enqueue(async () => {
      if (action === "mute") await call?.setReadAloud(state.snapshot.outputMuted);
      if (action === "playback") await call?.controller.stopPlayback();
      if (action === "input") { if (state.snapshot.inputPaused) call?.controller.resumeInput(); else await call?.controller.pauseInput(); }
    }); },
    dispose: () => enqueue(async () => { await end(); listeners.clear(); drafts.clear(); }),
  };
}
