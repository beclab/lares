import { createInterruptionGuard } from "./interruption.js";
import { mintRpcId } from "../larepass/rpc.js";

/** Device, agent and playback ports are injected; UI frameworks own no turn state. */
export function createVoiceController({ input, agent, output, voiceId = mintRpcId(), metric = () => {}, onTranscript = null, idleTimeoutMs = 300_000, recoveryTimeoutMs = 120_000, onExpired = () => {}, now = Date.now, schedule = setTimeout, unschedule = clearTimeout }) {
  let epoch = 0;
  let manualTurns = false;
  let take = null;
  let idleTimer = null;
  let recoveryTimer = null;
  const clearTimers = () => { unschedule(idleTimer); unschedule(recoveryTimer); };
  const expire = async (code) => {
    await controller.disconnect();
    await onExpired(code);
    change({ error: code });
  };
  const touch = () => {
    unschedule(idleTimer);
    if (state.connection !== "open") return;
    idleTimer = schedule(() => { void expire("voice_idle_timeout"); }, idleTimeoutMs);
    idleTimer.unref?.();
  };
  let creating = null;
  let state = Object.freeze({ voiceId, sessionId: null, connection: "closed", capture: "idle", agent: "idle", playback: "idle", continuous: false, inputPaused: false, userSpeaking: false, inputLevel: null, inputReady: false, outputMuted: false, error: null });
  const listeners = new Set();
  const change = (patch) => {
    state = Object.freeze({ ...state, ...patch });
    for (const listener of listeners) listener();
  };
  const report = (stage, started, extra = {}) => {
    try { metric({ voiceId: state.voiceId, sessionId: state.sessionId, stage, durationMs: Math.max(0, now() - started), ...extra }); } catch {}
  };
  const live = (run) => run.epoch === epoch && !run.abort.signal.aborted && state.connection === "open";
  const ensureSession = async () => {
    if (state.sessionId) return state.sessionId;
    creating ??= Promise.resolve(agent.create()).then((sessionId) => {
      if (!sessionId && !agent.lazy) throw new Error("voice_session_failed");
      return sessionId;
    });
    return creating;
  };
  const cancelInput = async () => {
    const old = take;
    take = null;
    old?.abort.abort();
    try { if (old) await input.cancel?.(); } finally { change({ capture: "idle", userSpeaking: false, inputLevel: null }); }
  };
  const interruption = createInterruptionGuard({ output, now, schedule, unschedule,
    onState: playback => change({ playback }), onError: error => change({ error }) });
  const interruptible = () => state.continuous && !manualTurns && input.capabilities?.bargeIn === true && input.capabilities?.echoTested === true && output.canPause === true;
  const stopPlayback = async () => {
    interruption.cancel();
    const started = now();
    const pending = output.stop();
    change({ playback: "idle" });
    await pending;
    report("interrupt", started);
  };
  const listen = async () => {
    if (state.connection !== "open" || state.inputPaused || take || state.capture !== "idle") return;
    if (!manualTurns && state.continuous && (
      (state.agent !== "idle" && !input.capabilities?.listenWhileWorking)
      || (state.playback !== "idle" && !interruptible())
    )) return;
    const run = { epoch, abort: new AbortController(), id: mintRpcId(), started: now() };
    take = run;
    change({ capture: "recording", inputReady: false, error: null });
    try {
      const text = String(await input.capture({ signal: run.abort.signal, continuous: state.continuous && !manualTurns, onReady: () => { if (live(run)) change({ inputReady: true }); }, onLevel: (level) => { if (live(run)) change({ inputLevel: Math.max(0, Math.min(1, level)) }); }, onSpeech: () => {
        if (live(run)) { touch(); change({ userSpeaking: true }); if (interruptible() && state.playback !== "idle") interruption.suspect(); }
      }, onTranscribing: () => { if (live(run)) { interruption.speechEnded(); change({ capture: "transcribing", userSpeaking: false }); } } }) ?? "").trim();
      if (!live(run)) return;
      report("recognition", run.started, { turnId: run.id });
      const confirming = interruption.pending;
      interruption.final(text);
      if (text && !confirming && interruptible() && state.playback !== "idle") await stopPlayback();
      if (!text) { run.waitingInterruption = confirming; return; }
      touch();
      if (onTranscript) {
        await onTranscript({ text, turnId: run.id, voiceId: state.voiceId, sessionId: state.sessionId, signal: run.abort.signal });
        return;
      }
      const sessionId = await ensureSession();
      if (!live(run)) return;
      change({ sessionId, capture: "idle", agent: "running" });
      await agent.submit({ sessionId, text, requestId: run.id, signal: run.abort.signal });
      // Acceptance is not completion; observeAgent receives the durable turn lifecycle.
    } catch (error) {
      if (live(run)) {
        interruption.fail(error.code || error.message || "voice_failed");
        await controller.disconnect(error.code || error.message || "voice_failed");
      }
    } finally {
      if (take === run) {
        take = null;
        change({ capture: "idle", userSpeaking: false, inputLevel: null });
        if (!manualTurns && state.continuous && state.connection === "open" && (state.agent === "idle" || input.capabilities?.listenWhileWorking) && (state.playback === "idle" || interruptible())) {
          queueMicrotask(() => { void listen(); });
        }
      }
    }
  };
  const controller = {
    getSnapshot: () => state,
    noteActivity: touch,
    setOutputMuted(outputMuted) { change({ outputMuted }); },
    bindSession(sessionId) { if (sessionId) change({ sessionId }); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async start({ sessionId = null, continuous = false, running = false, manual = false, shouldStart = () => true } = {}) {
      output.arm?.();
      manualTurns = manual;
      const startedEpoch = ++epoch;
      creating = null;
      await cancelInput();
      if (startedEpoch !== epoch) return;
      await stopPlayback();
      if (startedEpoch !== epoch) return;
      if (!shouldStart()) return;
      change({ voiceId, sessionId, continuous, inputPaused: false, connection: "open", agent: running ? "running" : "idle", error: null });
      clearTimers(); touch();
      if (!manualTurns) void listen();
    },
    listen,
    stopRecording: () => input.stop?.(),
    cancelRecording: cancelInput,
    async pauseInput() { change({ inputPaused: true }); await cancelInput(); },
    resumeInput() { change({ inputPaused: false }); void listen(); },
    stopPlayback,
    async cancelTask() {
      if (state.sessionId) await agent.cancel(state.sessionId);
    },
    observeAgent(running, playbackExpected = false) {
      if (playbackExpected && take && !interruptible()) void cancelInput();
      change({ agent: running ? "running" : "idle", ...(playbackExpected ? { playback: "pending" } : {}) });
      if (!manualTurns && !running && state.continuous) void listen();
    },
    observePlayback(playing) {
      if (!playing) interruption.outputEnded();
      if (playing !== (state.playback === "playing")) touch();
      change({ playback: playing ? "playing" : "idle" });
      if (!manualTurns && state.continuous && (!playing || interruptible())) void listen();
    },
    async pause() {
      clearTimers(); epoch += 1;
      change({ connection: "paused", error: null });
      recoveryTimer = schedule(() => { void expire("voice_recovery_expired"); }, recoveryTimeoutMs);
      recoveryTimer.unref?.();
      await Promise.allSettled([cancelInput(), stopPlayback()]);
    },
    async disconnect(code = null) {
      clearTimers();
      if (code) {
        recoveryTimer = schedule(() => { void expire("voice_recovery_expired"); }, recoveryTimeoutMs);
        recoveryTimer.unref?.();
      }
      epoch += 1;
      change({ connection: code ? "paused" : "closed", error: code });
      await Promise.allSettled([cancelInput(), stopPlayback()]);
    },
    async resume({ shouldResume = () => true } = {}) {
      const resumedEpoch = epoch;
      if (state.connection !== "paused") return;
      const running = state.sessionId ? await agent.running(state.sessionId) : false;
      if (resumedEpoch !== epoch || !shouldResume()) return;
      clearTimers();
      change({ connection: "open", agent: running ? "running" : "idle", error: null });
      touch(); if (!manualTurns) void listen();
    },
  };
  return controller;
}
