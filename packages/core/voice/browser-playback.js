export function createBrowserPlayer() {
  let element = null;
  let finish = null;
  const stop = () => {
    element?.pause();
    finish?.();
  };
  return {
    play(blob) {
      stop();
      return new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        const done = () => {
          if (finish !== done) return;
          finish = null;
          element = null;
          URL.revokeObjectURL(url);
          resolve();
        };
        element = audio;
        finish = done;
        audio.addEventListener("ended", done, { once: true });
        audio.addEventListener("error", done, { once: true });
        audio.play().catch(done);
      });
    },
    stop,
  };
}
