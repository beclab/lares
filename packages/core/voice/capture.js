import { pcmToWav } from "../router/tts.js";
import { ENDPOINT, createSpeechEndpoint } from "./endpoint.js";
import { MIN_RECORDING_MS } from "./recorder.js";

const FRAME_BYTES = 1024;
const FRAME_MS = 32;
const NO_INPUT_MS = 10_000;
const POLL_MS = 40;
const CLIENT_LOST_MS = 5000;
const HOST_RATE = 16_000;
const PLAYBACK_SETTLE_MS = 320;
const PLAYBACK_LEADING_MS = 2500;

/**
 * The mic still hears the end of playback after the speaker stops. That tail
 * is loud and then quiet, so it would complete the take before anyone speaks.
 * Drop it once the input has gone quiet. Sound that never lets up is the
 * person already talking, and that stays in the take.
 */
function createPlaybackGate() {
  let residue = false;
  let listening = false;
  let quietMs = 0;
  let loudMs = 0;
  return (audible, rms) => {
    if (listening) return "listen";
    const quiet = !audible || rms < ENDPOINT.floor;
    if (!residue) {
      if (quiet) {
        quietMs += FRAME_MS;
        if (quietMs >= PLAYBACK_SETTLE_MS) listening = true;
        return listening ? "listen" : "wait";
      }
      residue = true;
      quietMs = 0;
      loudMs = FRAME_MS;
      return "wait";
    }
    if (quiet) {
      quietMs += FRAME_MS;
      loudMs = 0;
      if (quietMs >= PLAYBACK_SETTLE_MS) {
        listening = true;
        return "drop";
      }
      return "wait";
    }
    quietMs = 0;
    loudMs += FRAME_MS;
    if (loudMs >= PLAYBACK_LEADING_MS) {
      listening = true;
      return "listen";
    }
    return "wait";
  };
}

/**
 * Loudness of one 16-bit little-endian frame, and whether it is live microphone
 * signal. The headset link opens with a short full-scale burst inside digital
 * silence; a frame that is mostly exact zeros is not the microphone yet.
 */
export function pcm16Level(bytes) {
  const samples = Math.floor(bytes.length / 2);
  if (!samples) return { rms: 0, audible: false };
  let sum = 0;
  let zeros = 0;
  for (let i = 0; i < samples; i += 1) {
    const sample = bytes.readInt16LE(i * 2);
    if (sample === 0) zeros += 1;
    const unit = sample / 32768;
    sum += unit * unit;
  }
  return { rms: Math.sqrt(sum / samples), audible: zeros * 2 < samples };
}

/**
 * One take recorded on the machine that owns the headset.
 * `skipped` means there is no headset microphone on this machine.
 */
export function createCaptureSession(io) {
  const sleep = io.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = io.now ?? Date.now;
  let job = null;

  function status() {
    if (!job) return { phase: "idle" };
    job.seen = now();
    return {
      phase: job.phase,
      text: job.text ?? "",
      error: job.error ?? "",
      at: job.recordingAt ?? 0,
    };
  }

  function stop(cancel) {
    if (!job) return;
    job.seen = now();
    if (cancel) {
      job.cancel = true;
      job.controller.abort();
    }
    else job.stop = true;
  }

  async function start() {
    if (job && (job.phase === "preparing" || job.phase === "recording" || job.phase === "transcribing")) {
      const previous = job;
      previous.cancel = true;
      previous.controller.abort();
      for (let attempts = 0; job === previous && attempts < 25; attempts += 1) {
        await sleep(POLL_MS);
      }
      if (job === previous) throw new Error("voice_failed");
    }
    const run = {
      phase: "preparing",
      text: "",
      error: "",
      recordingAt: 0,
      seen: now(),
      cancel: false,
      stop: false,
      controller: new AbortController(),
    };
    job = run;
    let opened;
    try { opened = await io.open(); }
    catch (error) {
      run.phase = "error";
      run.error = error?.code || "voice_failed";
      throw error;
    }
    if (run.cancel) {
      await io.close?.();
      run.phase = "idle";
      job = null;
      return { cancelled: true };
    }
    if (opened?.skipped) {
      job = null;
      return { skipped: true };
    }
    if (!opened?.ready) {
      run.phase = "error";
      run.error = "voice_bluetooth_not_ready";
      throw new Error("voice_bluetooth_not_ready");
    }

    let endpoint = createSpeechEndpoint();
    const gate = opened.settle ? createPlaybackGate() : null;
    let offset = Number(opened.offset) || 0;
    let pending = Buffer.alloc(0);
    let pcm = Buffer.alloc(0);
    let utteranceFrom = 0;
    const started = now();
    // `live`: the link delivers samples. Room noise is live too, so only
    // `spoke` (a speech-level frame) keeps the take open past NO_INPUT_MS.
    let live = false;
    let spoke = false;
    run.phase = "recording";
    run.recordingAt = now();
    run.seen = run.recordingAt;

    void (async () => {
      try {
        while (run === job && run.phase !== "done" && run.phase !== "error" && run.phase !== "idle") {
          if (run.phase === "recording" && now() - run.seen > CLIENT_LOST_MS) run.cancel = true;
          const fresh = await io.read(offset);
          offset += fresh.length;
          if (fresh.length) {
            pcm = Buffer.concat([pcm, fresh]);
            pending = Buffer.concat([pending, fresh]);
          }
          while (pending.length >= FRAME_BYTES) {
            const frame = pending.subarray(0, FRAME_BYTES);
            pending = pending.subarray(FRAME_BYTES);
            const level = pcm16Level(frame);
            if (gate) {
              const verdict = gate(level.audible, level.rms);
              if (verdict === "wait") continue;
              if (verdict === "drop") {
                utteranceFrom = pcm.length - pending.length;
                endpoint = createSpeechEndpoint();
                continue;
              }
            }
            if (level.audible) live = true;
            if (level.audible && level.rms >= ENDPOINT.floor) spoke = true;
            if (live && endpoint.push(1, level.rms, FRAME_MS)) run.stop = true;
          }
          if (run.cancel) {
            await io.close?.();
            run.phase = "idle";
            if (job === run) job = null;
            return;
          }
          if (!spoke && now() - started >= NO_INPUT_MS) {
            await io.close?.();
            if (!live) await io.reset?.();
            run.phase = "error";
            run.error = "voice_no_input";
            return;
          }
          if (run.stop) {
            const audio = pcm.subarray(utteranceFrom);
            const durationMs = (audio.length / 2 / HOST_RATE) * 1000;
            await io.close?.();
            if (durationMs < MIN_RECORDING_MS) {
              run.phase = "error";
              run.error = "voice_too_short";
              return;
            }
            if (!live) {
              await io.reset?.();
              run.phase = "error";
              run.error = "voice_no_input";
              return;
            }
            run.phase = "transcribing";
            try {
              run.text = String(await io.transcribe(
                pcmToWav(audio, HOST_RATE),
                run.controller.signal,
              ) ?? "");
            } catch (err) {
              if (run.cancel || run.controller.signal.aborted) {
                run.phase = "idle";
                if (job === run) job = null;
                return;
              }
              throw err;
            }
            if (run.cancel) {
              run.phase = "idle";
              if (job === run) job = null;
              return;
            }
            run.phase = "done";
            return;
          }
          await sleep(POLL_MS);
        }
      } catch {
        await io.close?.().catch(() => {});
        run.phase = "error";
        run.error = "voice_failed";
      }
    })();

    return { recording: true, at: run.recordingAt };
  }

  return { start, stop, status };
}
