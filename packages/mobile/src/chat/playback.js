const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

/**
 * One element, unlocked inside the gesture that asks the question (a voice
 * press or a send tap), then reused for the answer. iOS only lets an element
 * play later if it first played inside a gesture.
 */
export function createAnswerPlayer() {
  const audio = typeof Audio === "function" ? new Audio() : null;
  let url = "";
  let settle = null;
  const finish = (played) => {
    const done = settle;
    settle = null;
    if (url) {
      URL.revokeObjectURL(url);
      url = "";
    }
    done?.(played);
  };
  return {
    unlock() {
      if (!audio || !audio.paused) return;
      audio.src = SILENT_WAV;
      void audio.play().catch(() => {});
    },
    /** Resolves when the clip ends (true), or is stopped or fails (false). */
    async play(blob) {
      if (!audio || !blob) return false;
      finish(false);
      url = URL.createObjectURL(blob);
      audio.src = url;
      const ended = new Promise((resolve) => {
        settle = resolve;
      });
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      try {
        await audio.play();
      } catch {
        finish(false);
      }
      return ended;
    },
    stop() {
      audio?.pause();
      finish(false);
    },
  };
}
