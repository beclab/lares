import { primePlaybackContext } from "@olares/lares-core/voice/pcm-player";

/**
 * 16-bit silence at the playback clock. iOS keeps one hardware rate; the old
 * 8 kHz unlock left the iPhone speaker resampling the readout into a buzz.
 */
function unlockClip(sampleRate) {
  const rate = Number.isInteger(sampleRate) && sampleRate >= 8000 && sampleRate <= 192000 ? sampleRate : 48000;
  const dataBytes = 128 * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const text = (offset, value) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

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
      const context = primePlaybackContext();
      if (!audio || !audio.paused) return;
      audio.src = unlockClip(context?.sampleRate);
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
