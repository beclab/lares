import React from "react";
import { Tooltip } from "@deepseek-ai/dsh-client-ui-primitives";
import {
  getCapture,
  postCaptureCancel,
  postCaptureStart,
  postCaptureStop,
} from "@olares/lares-core/voice/client";
import { captureSource } from "@olares/lares-core/voice/input";
import { MicGlyph, Spinner } from "./icons.js";
import { messageFor, useT } from "./locale.js";
import { formatElapsed } from "@olares/lares-core/voice/recorder";
import micCss from "./styles/mic.css";

const { useCallback, useEffect, useRef, useState } = React;
const h = React.createElement;

export { micCss };

export function MicButton(props) {
  const t = useT();
  const sessionIdRef = useRef(props.sessionId);
  sessionIdRef.current = props.sessionId;
  const sendRef = useRef(props.send);
  sendRef.current = props.send;
  const canSend = Boolean(props.sessionId && props.send);

  const [phase, setPhase] = useState("idle"); // idle | preparing | recording | transcribing | error
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  const startedRef = useRef(0);
  const timerRef = useRef(0);
  const mountedRef = useRef(true);
  const errorTimerRef = useRef(0);
  const hostRef = useRef(false);
  const pollRef = useRef(0);
  const startAbortRef = useRef(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = 0;
    }
  }, []);

  const stopHostPoll = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = 0;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopTimer();
      stopHostPoll();
      if (hostRef.current) void postCaptureCancel();
      hostRef.current = false;
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, [stopHostPoll, stopTimer]);

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

  const watchHost = useCallback(() => {
    const tick = async () => {
      if (!mountedRef.current || !hostRef.current) return;
      let status;
      try {
        status = await getCapture();
      } catch (err) {
        if (!mountedRef.current || !hostRef.current) return;
        hostRef.current = false;
        failWith(err instanceof Error ? err.message : "voice_failed");
        return;
      }
      if (!mountedRef.current || !hostRef.current) return;
      if (status.phase === "transcribing") {
        stopTimer();
        setPhase("transcribing");
      }
      if (status.phase === "done") {
        hostRef.current = false;
        stopTimer();
        const text = String(status.text ?? "").trim();
        if (!text) {
          failWith("voice_no_input");
          return;
        }
        try {
          await sendRef.current?.(sessionIdRef.current, text);
        } catch (err) {
          failWith(err instanceof Error ? err.message : "voice_failed");
          return;
        }
        if (!mountedRef.current) return;
        setPhase("idle");
        return;
      }
      if (status.phase === "idle") {
        hostRef.current = false;
        stopTimer();
        setPhase("idle");
        return;
      }
      if (status.phase === "error") {
        hostRef.current = false;
        stopTimer();
        failWith(status.error || "voice_failed");
        return;
      }
      pollRef.current = setTimeout(tick, 200);
    };
    stopHostPoll();
    pollRef.current = setTimeout(tick, 200);
  }, [failWith, stopHostPoll, stopTimer]);

  const start = useCallback(async () => {
    if (captureSource("pc") !== "headset") return;
    if (!sessionIdRef.current || !sendRef.current) return;
    if (phase === "preparing" || phase === "recording" || phase === "transcribing") return;
    setError(null);
    hostRef.current = false;
    setPhase("preparing");
    const controller = new AbortController();
    startAbortRef.current = controller;
    let opened;
    try {
      opened = await postCaptureStart(controller.signal);
    } catch (err) {
      if (!mountedRef.current || controller.signal.aborted) {
        if (mountedRef.current) setPhase("idle");
        return;
      }
      failWith(err instanceof Error ? err.message : "voice_failed");
      return;
    } finally {
      if (startAbortRef.current === controller) startAbortRef.current = null;
    }
    if (!mountedRef.current || opened?.cancelled) {
      if (!mountedRef.current && opened?.recording) void postCaptureCancel();
      if (mountedRef.current) setPhase("idle");
      return;
    }
    if (opened?.skipped || !opened?.recording) {
      failWith("voice_bluetooth_not_ready");
      return;
    }
    hostRef.current = true;
    startedRef.current = opened?.at || Date.now();
    setElapsed(0);
    setPhase("recording");
    timerRef.current = setInterval(() => setElapsed(Date.now() - startedRef.current), 200);
    watchHost();
  }, [failWith, phase, watchHost]);

  const stop = useCallback((cancel) => {
    if (!hostRef.current) {
      stopTimer();
      setPhase("idle");
      return;
    }
    if (cancel) {
      hostRef.current = false;
      stopHostPoll();
      stopTimer();
      void postCaptureCancel();
      setPhase("idle");
      return;
    }
    stopTimer();
    setPhase("transcribing");
    void postCaptureStop();
  }, [stopHostPoll, stopTimer]);

  const onClick = useCallback(() => {
    if (phase === "recording") stop(false);
    else if (phase === "idle" || phase === "error") void start();
  }, [phase, start, stop]);

  const recording = phase === "recording";
  const preparing = phase === "preparing";
  const busy = phase === "transcribing" || preparing;
  const disabled = busy || (!canSend && !recording);
  const title = error
    ? error
    : preparing
      ? t("mic.preparing")
      : recording
        ? t("mic.stop")
        : busy
          ? t("mic.transcribing")
        : canSend
          ? t("mic.idle")
          : t("mic.blocked");

  return h(
    Tooltip,
    { label: title, side: "top", delayMs: 500 },
    h(
      "button",
      {
        type: "button",
        className: "lares-voice-mic",
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
              { className: "lares-voice-live" },
              h("span", { className: "lares-voice-dot" }),
              formatElapsed(elapsed),
            )
          : MicGlyph(),
    ),
  );
}
