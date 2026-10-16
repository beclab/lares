import { mintRpcId } from "../larepass/rpc.js";

/** Device, agent and playback ports are injected; UI frameworks own no turn state. */
export function createVoiceController({ input, agent, output, metric = () => {}, now = Date.now }) {
  let epoch = 0;
  let take = null;
  let creating = null;
  let state = Object.freeze({ voiceId: mintRpcId(), sessionId: null, connection: "closed", capture: "idle", agent: "idle", playback: "idle", continuous: false, error: null });
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
      if (!sessionId) throw new Error("voice_session_failed");
      return sessionId;
    });
    return creating;
  };
  const cancelInput = async () => {
    const old = take;
    take = null;
    old?.abort.abort();
    await input.cancel?.();
    change({ capture: "idle" });
  };
  const stopPlayback = async () => {
    const started = now();
    await output.stop();
    change({ playback: "idle" });
    report("interrupt", started);
  };
  const listen = async () => {
    if (state.connection !== "open" || take || state.capture !== "idle") return;
    if ((state.agent !== "idle" || state.playback !== "idle") && state.continuous && !input.capabilities?.bargeIn) return;
    const run = { epoch, abort: new AbortController(), id: mintRpcId(), started: now() };
    take = run;
    change({ capture: "recording", error: null });
    try {
      const text = String(await input.capture({ signal: run.abort.signal, onSpeech: () => {
        if (live(run) && input.capabilities?.bargeIn) void stopPlayback();
      }, onTranscribing: () => { if (live(run)) change({ capture: "transcribing" }); } }) ?? "").trim();
      if (!live(run)) return;
      report("recognition", run.started, { turnId: run.id });
      if (!text) return;
      const sessionId = await ensureSession();
      if (!live(run)) return;
      change({ sessionId, capture: "idle", agent: "running" });
      await agent.submit({ sessionId, text, requestId: run.id, signal: run.abort.signal });
      // Acceptance is not completion; observeAgent receives the durable turn lifecycle.
    } catch (error) {
      if (live(run)) {
        change({ connection: "paused", capture: "idle", error: error.code || error.message || "voice_failed" });
        await output.stop();
      }
    } finally {
      if (take === run) {
        take = null;
        change({ capture: "idle" });
        if (state.continuous && state.connection === "open" && state.agent === "idle" && state.playback === "idle") {
          queueMicrotask(() => { void listen(); });
        }
      }
    }
  };
  return {
    getSnapshot: () => state,
    bindSession(sessionId) { if (sessionId) change({ sessionId }); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async start({ sessionId = null, continuous = false } = {}) {
      epoch += 1;
      creating = null;
      await cancelInput();
      await stopPlayback();
      change({ voiceId: mintRpcId(), sessionId, continuous, connection: "open", agent: "idle", error: null });
      void listen();
    },
    listen,
    stopRecording: () => input.stop?.(),
    cancelRecording: cancelInput,
    stopPlayback,
    async cancelTask() {
      if (state.sessionId) await agent.cancel(state.sessionId);
    },
    observeAgent(running, playbackExpected = false) {
      change({ agent: running ? "running" : "idle", ...(playbackExpected ? { playback: "pending" } : {}) });
      if (!running && state.continuous) void listen();
    },
    observePlayback(playing) {
      change({ playback: playing ? "playing" : "idle" });
      if (!playing && state.continuous) void listen();
    },
    async disconnect(code = null) {
      epoch += 1;
      change({ connection: code ? "paused" : "closed", error: code });
      await cancelInput();
      await stopPlayback();
    },
    async resume() {
      if (state.connection !== "paused") return;
      const running = state.sessionId ? await agent.running(state.sessionId) : false;
      change({ connection: "open", agent: running ? "running" : "idle", error: null });
      void listen();
    },
  };
}
