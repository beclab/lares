/**
 * One headset call link is half duplex. The newest recording owns it and
 * invalidates synthesis that has not reached the speaker yet.
 */
export function createDuplexCoordinator(stopPlayback = async () => {}) {
  let speech = null;

  function beginSpeech(externalSignal, id = "") {
    if (speech && (!id || speech.id !== id)) {
      speech.controller.abort();
      void Promise.resolve(stopPlayback()).catch(() => {});
      speech = null;
    }
    if (speech && id && speech.id === id) return speech.pub;
    const controller = new AbortController();
    const lease = {
      id,
      controller,
      active() {
        return speech === lease && !controller.signal.aborted;
      },
      finish() {
        if (speech === lease) speech = null;
      },
    };
    lease.pub = { signal: controller.signal, active: lease.active, finish: lease.finish };
    speech = lease;
    if (externalSignal) {
      const abort = () => {
        if (speech === lease) speech = null;
        controller.abort();
        void Promise.resolve(stopPlayback()).catch(() => {});
      };
      if (externalSignal.aborted) abort();
      else externalSignal.addEventListener("abort", abort, { once: true });
    }
    return lease.pub;
  }

  async function interrupt(id = "") {
    if (id && speech?.id !== id) return;
    const current = speech;
    speech = null;
    current?.controller.abort();
    await stopPlayback();
  }

  return { beginSpeech, interrupt, isSpeaking: () => Boolean(speech && !speech.controller.signal.aborted) };
}
