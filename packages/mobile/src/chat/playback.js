const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

/**
 * One element, unlocked inside the gesture that asks the question (a voice
 * press or a send tap), then reused for the answer. iOS only lets an element
 * play later if it first played inside a gesture.
 */
export function createAnswerPlayer() {
  const audio = typeof Audio === "function" ? new Audio() : null;
  let url = "";
  const release = () => {
    if (!url) return;
    URL.revokeObjectURL(url);
    url = "";
  };
  return {
    unlock() {
      if (!audio || !audio.paused) return;
      audio.src = SILENT_WAV;
      void audio.play().catch(() => {});
    },
    async play(blob) {
      if (!audio || !blob) return false;
      release();
      url = URL.createObjectURL(blob);
      audio.src = url;
      audio.onended = release;
      try {
        await audio.play();
        return true;
      } catch {
        release();
        return false;
      }
    },
    stop() {
      audio?.pause();
      release();
    },
  };
}
