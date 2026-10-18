export function createBrowserPlayer() {
  let element = null, finish = null, paused = false;
  const stop = () => { paused = false; element?.pause(); finish?.(); };
  return {
    canPause: true,
    pause() { paused = true; element?.pause(); },
    resume() { paused = false; return element?.play(); },
    play(blob) {
      const preservePause = paused;
      stop(); paused = preservePause;
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob), audio = new Audio(url);
        const done = (error) => {
          if (finish !== done) return;
          finish = null; element = null; URL.revokeObjectURL(url);
          error ? reject(error) : resolve();
        };
        element = audio; finish = done;
        audio.addEventListener("ended", () => done(), { once: true });
        audio.addEventListener("error", () => done(new Error("voice_playback_failed")), { once: true });
        if (!paused) audio.play().catch(done);
      });
    },
    stop,
  };
}
