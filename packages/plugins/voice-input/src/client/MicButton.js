import React from "react";
import { Tooltip } from "@deepseek-ai/dsh-client-ui-primitives";
import { mergeTranscript, postTranscribe } from "./api.js";
import { MicGlyph, Spinner } from "./icons.js";
import { messageFor, useT } from "./locale.js";
import { formatElapsed, MIN_RECORDING_MS, pickRecordingMime } from "./recorder.js";
import micCss from "./styles/mic.css";

const { useCallback, useEffect, useRef, useState } = React;
const h = React.createElement;

export { micCss };

export function MicButton(props) {
  const t = useT();
  const inputActions = props.inputActions;
  const draft = props.useInput ? props.useInput((state) => state?.draft ?? "") : "";
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Outside `plain`, setDraft is dropped — queue until composer is writable again.
  const inputPhase = props.useInput ? props.useInput((state) => state?.phase ?? null) : null;
  const composerReady = inputPhase === "plain" && typeof inputActions?.setDraft === "function";
  const composerReadyRef = useRef(composerReady);
  composerReadyRef.current = composerReady;
  const pendingRef = useRef(null);

  const [phase, setPhase] = useState("idle"); // idle | recording | transcribing | error
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedRef = useRef(0);
  const timerRef = useRef(0);
  const cancelRef = useRef(false);
  const mountedRef = useRef(true);
  const errorTimerRef = useRef(0);
  const transcribeRef = useRef(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = 0;
    }
  }, []);

  const releaseStream = useCallback(() => {
    const stream = streamRef.current;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopTimer();
      releaseStream();
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      transcribeRef.current?.abort();
    };
  }, [stopTimer, releaseStream]);

  const failWith = useCallback((code) => {
    if (!mountedRef.current) return;
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setError(messageFor(t, code));
    setPhase("error");
    errorTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      setPhase((current) => (current === "error" ? "idle" : current));
      setError(null);
      errorTimerRef.current = 0;
    }, 3200);
  }, [t]);

  const finish = useCallback(async () => {
    stopTimer();
    const took = Date.now() - startedRef.current;
    const chunks = chunksRef.current;
    chunksRef.current = [];
    const type = recorderRef.current?.mimeType || "audio/webm";
    releaseStream();
    if (!mountedRef.current) return;
    if (cancelRef.current) {
      setPhase("idle");
      return;
    }
    const blob = new Blob(chunks, { type });
    if (took < MIN_RECORDING_MS || blob.size < 1024) {
      failWith("voice_too_short");
      return;
    }
    setPhase("transcribing");
    const controller = new AbortController();
    transcribeRef.current = controller;
    try {
      const text = await postTranscribe(blob, props.language, controller.signal);
      if (!mountedRef.current) return;
      setPhase("idle");
      if (!text) return;
      if (composerReadyRef.current) {
        inputActions.setDraft(mergeTranscript(draftRef.current, text));
      } else {
        pendingRef.current = text;
      }
    } catch (err) {
      if (!mountedRef.current || controller.signal.aborted) return;
      failWith(err instanceof Error ? err.message : "voice_failed");
    } finally {
      if (transcribeRef.current === controller) transcribeRef.current = null;
    }
  }, [failWith, inputActions, props.language, releaseStream, stopTimer]);

  useEffect(() => {
    if (!composerReady || pendingRef.current === null) return;
    const text = pendingRef.current;
    pendingRef.current = null;
    inputActions.setDraft(mergeTranscript(draftRef.current, text));
  }, [composerReady, inputActions]);

  const start = useCallback(async () => {
    if (!composerReady) return;
    if (phase === "recording" || phase === "transcribing") return;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      failWith("voice_unsupported");
      return;
    }
    setError(null);
    cancelRef.current = false;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
    } catch {
      failWith("voice_permission_denied");
      return;
    }
    if (!mountedRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    const mime = pickRecordingMime();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      void finish();
    };
    startedRef.current = Date.now();
    setElapsed(0);
    setPhase("recording");
    recorder.start();
    timerRef.current = setInterval(() => setElapsed(Date.now() - startedRef.current), 200);
  }, [composerReady, failWith, finish, phase]);

  const stop = useCallback((cancel) => {
    cancelRef.current = Boolean(cancel);
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else {
      stopTimer();
      releaseStream();
      setPhase("idle");
    }
  }, [releaseStream, stopTimer]);

  const onClick = useCallback(() => {
    if (phase === "recording") stop(false);
    else if (phase === "idle" || phase === "error") void start();
  }, [phase, start, stop]);

  const recording = phase === "recording";
  const busy = phase === "transcribing";
  // Allow stop while recording even if the composer locks mid-take.
  const disabled = busy || (!composerReady && !recording);
  const title = error
    ? error
    : recording
      ? t("mic.stop")
      : busy
        ? t("mic.transcribing")
        : composerReady
          ? t("mic.idle")
          : t("mic.blocked");

  return h(
    Tooltip,
    { label: title, side: "top", delayMs: 500 },
    h(
      "button",
      {
        type: "button",
        className: "dina-voice-mic",
        "data-phase": phase,
        "aria-label": title,
        disabled,
        onClick,
        onKeyDown: recording
          ? (event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              stop(true);
            }
          : undefined,
        onContextMenu: recording
          ? (event) => {
              event.preventDefault();
              stop(true);
            }
          : undefined,
      },
      busy
        ? Spinner(14)
        : recording
          ? h(
              "span",
              { className: "dina-voice-live" },
              h("span", { className: "dina-voice-dot" }),
              formatElapsed(elapsed),
            )
          : MicGlyph(),
    ),
  );
}
