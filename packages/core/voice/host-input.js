export function createHostInput(port) {
  let abort = null;
  return {
    capabilities: { duplex: false, bargeIn: false, audio: "pcm16-16000" },
    async capture({ signal, onTranscribing, continuous = false } = {}) {
      abort = new AbortController();
      const current = abort;
      const cancel = () => current.abort();
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        if (signal?.aborted) return "";
        const opened = await port.start(current.signal);
        if (!opened.recording) throw new Error("voice_bluetooth_not_ready");
        while (!current.signal.aborted) {
          const state = await port.status(current.signal);
          if (state.phase === "transcribing") onTranscribing?.();
          if (state.phase === "done") return state.text;
          if (state.phase === "error") {
            if (continuous && ["voice_no_input", "voice_too_short"].includes(state.error)) return "";
            throw new Error(state.error);
          }
          if (state.phase === "idle") return "";
          await new Promise((resolve) => {
            const finish = () => { clearTimeout(timer); current.signal.removeEventListener("abort", finish); resolve(); };
            const timer = setTimeout(finish, 200);
            current.signal.addEventListener("abort", finish, { once: true });
          });
        }
        return "";
      } catch (error) {
        if (current.signal.aborted) return "";
        throw error;
      } finally { signal?.removeEventListener("abort", cancel); }
    },
    stop: () => port.stop(),
    async cancel() { if (!abort) return; abort.abort(); abort = null; await port.cancel(); },
  };
}
