import React from "react";
import { createPortal } from "react-dom";

const h = React.createElement;
const { useLayoutEffect, useRef, useState, useSyncExternalStore } = React;

export function createPreviewOverlay(workspace, PreviewView) {
  return function FilePreviewOverlay({ sessionId }) {
    const [target, setTarget] = useState(null);
    const snapshot = useSyncExternalStore(
      (listener) => workspace.subscribe(sessionId, listener),
      () => workspace.getSnapshot(sessionId),
    );
    const owns = snapshot.mode === "preview" && Boolean(snapshot.activePath);
    const previousSession = useRef(sessionId);

    // The overlay lives in the session header outlet; the scrollport lives in
    // the body outlet. Those fill independently, so a mount-time query is often
    // null and would never retry — the file tab appears, the page does not.
    useLayoutEffect(() => {
      if (!owns) return undefined;
      const find = () => document.querySelector("[data-conversation-scroll]");
      setTarget(find());
      if (find()) return undefined;
      const frame = requestAnimationFrame(() => setTarget(find()));
      return () => cancelAnimationFrame(frame);
    }, [owns, sessionId]);

    // Before paint of the commit that released the scrollport: the flow is
    // scrollable again here, so the reader lands where they were. A session
    // change discards the previous offset — that scroller is already gone.
    useLayoutEffect(() => {
      if (previousSession.current !== sessionId) {
        workspace.abandonChatScroll(previousSession.current);
        previousSession.current = sessionId;
      }
      if (owns) return;
      workspace.restoreChatScroll(sessionId);
    }, [sessionId, owns]);

    if (!target || !owns) return null;
    return createPortal(
      h(
        "div",
        {
          className: "lares-preview-overlay",
          "data-file-preview-overlay": "",
          // dsh contract: a view owning the scrollport pins the composer seat
          // and clips the chat flow, so this surface is the only scroller.
          "data-conversation-composer-overlay": "",
        },
        h(PreviewView, { sessionId }),
      ),
      target,
    );
  };
}
